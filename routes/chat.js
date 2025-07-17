const express = require('express');
const Chat = require('../models/Chat');
const User = require('../models/User');
const fetchuser = require('../middleware/fetchuser');
const { body, validationResult } = require('express-validator');
const router = express.Router();

// Route 1: Access or create a one-on-one chat
router.post('/', fetchuser, [
    body('userId', 'userId must be a valid Mongo ID').notEmpty().isMongoId()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const currentUserId = req.user.id;
    const receiverId = req.body.userId;

    try {
        const currentUser = await User.findById(currentUserId);
        if (!currentUser.friends.includes(receiverId)) {
            return res.status(403).json({ error: "You can only chat with approved users." });
        }

        let isChat = await Chat.findOne({
            isGroupChat: false,
            users: { $all: [currentUserId, receiverId] }
        }).populate('users', '-password')
            .populate('latestMessage');

        isChat = await User.populate(isChat, {
            path: 'latestMessage.sender',
            select: 'username avatar email'
        });

        if (isChat) return res.status(200).json(isChat);

        const newChat = await Chat.create({
            chatName: 'sender',
            isGroupChat: false,
            users: [currentUserId, receiverId]
        });

        const fullChat = await Chat.findById(newChat._id).populate('users', '-password');
        res.status(200).json(fullChat);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Route 2: Get all chats for logged in user
router.get('/', fetchuser, async (req, res) => {
    try {
        const chats = await Chat.find({ users: { $elemMatch: { $eq: req.user.id } } })
            .populate('users', '-password')
            .populate('groupAdmin', '-password')
            .populate({
                path: 'latestMessage',
                populate: {
                    path: 'sender',
                    select: 'username avatar email',
                },
            })
            .sort({ updatedAt: -1 });
        res.status(200).json(chats);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Route 3: Create new group chat
router.post('/group', fetchuser, [
    body('chatName').isLength({ min: 3, max: 30 }).withMessage('Group name must be 3-30 characters'),
    body('userIds').isArray({ min: 2 }).withMessage('At least 2 users required').custom(ids => ids.every(id => /^[a-f\d]{24}$/i.test(id)))
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { chatName, userIds } = req.body;
    const currentUserId = req.user.id;

    try {
        const currentUser = await User.findById(currentUserId);
        const notFriends = userIds.filter(id => !currentUser.friends.includes(id));
        if (notFriends.length > 0) {
            return res.status(403).json({ error: "All users must be approved friends to create a group." });
        }

        const allUsers = await User.find({ _id: { $in: userIds } });
        if (allUsers.length !== userIds.length) {
            return res.status(404).json({ error: "One or more userIds do not exist." });
        }

        const group = await Chat.create({
            chatName,
            isGroupChat: true,
            users: [...userIds, currentUserId],
            groupAdmin: currentUserId
        });

        const fullChat = await Chat.findById(group._id)
            .populate('users', '-password')
            .populate('groupAdmin', '-password');

        res.status(200).json(fullChat);
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Route 4: Rename group
router.put('/rename/:id', fetchuser, [
    body('chatName').isLength({ min: 3, max: 30 }).withMessage('Group name must be 3-30 characters')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { chatName } = req.body;

    try {
        const chat = await Chat.findById(req.params.id);
        if (!chat) return res.status(404).json({ error: "Group not found" });

        if (req.user.id !== chat.groupAdmin.toString()) {
            return res.status(403).json({ error: 'Only admin can rename the group' });
        }

        chat.chatName = chatName;
        await chat.save();

        res.json({ chatName: chat.chatName });
    } catch (error) {
        res.status(500).send("Internal server error");
    }
});

//Route5 : Add user to group
router.put('/group-add/:id', fetchuser, [
    body('userIds', 'userIds must be a non-empty array of valid Mongo IDs')
        .isArray({ min: 1 })
        .custom((userIds) => {
            return userIds.every(id => /^[a-f\d]{24}$/i.test(id));
        })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { userIds } = req.body;

    try {
        const chat = await Chat.findById(req.params.id);
        if (!chat) {
            return res.status(404).json({ error: "Group not found" });
        }

        if (req.user.id !== chat.groupAdmin.toString()) {
            return res.status(403).json({ error: 'Only admin can add users' });
        }

        const currentUser = await User.findById(req.user.id);
        const notFriends = userIds.filter(id => !currentUser.friends.includes(id));
        if (notFriends.length > 0) {
            return res.status(403).json({ error: "All users must be your friends." });
        }

        const addedChat = await Chat.findByIdAndUpdate(
            req.params.id,
            { $addToSet: { users: { $each: userIds } } },
            { new: true }
        ).populate('users', '-password');

        res.json({ message: 'Users added to group', users: addedChat.users });
    } catch (error) {
        console.error(error.message);
        res.status(500).send("Internal server error");
    }
});

// Route 6: Remove users from group
router.put('/group-remove/:id', fetchuser, [
    body('userIds').isArray({ min: 1 }).withMessage('Must provide userIds array')
        .custom(ids => ids.every(id => /^[a-f\d]{24}$/i.test(id)))
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { userIds } = req.body;

    try {
        const chat = await Chat.findById(req.params.id);
        if (!chat) return res.status(404).json({ error: "Group not found" });

        if (req.user.id !== chat.groupAdmin.toString()) {
            return res.status(403).json({ error: 'Only admin can remove users' });
        }

        chat.users = chat.users.filter(
            id => !userIds.includes(id.toString())
        );
        await chat.save();
        await chat.save();

        res.json({ message: 'Users removed successfully.' });
    } catch (error) {
        res.status(500).send("Internal server error");
    }
});

module.exports = router;
