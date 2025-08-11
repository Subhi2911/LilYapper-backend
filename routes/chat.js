const express = require('express');
const Chat = require('../models/Chat');
const User = require('../models/User');
const fetchuser = require('../middleware/fetchuser');
const { body, validationResult } = require('express-validator');
const { decrypt } = require('../utils/encryption');
const Message = require('../models/Message');
const router = express.Router();
module.exports = (io) => {
    // Route 1: create one-to-one chat
    router.post('/', fetchuser,
        [
            body('userId', 'userId must be a valid Mongo ID').notEmpty().isMongoId()
        ],
        async (req, res) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

            const currentUserId = req.user.id;
            const receiverId = req.body.userId;

            if (currentUserId === receiverId) {
                return res.status(400).json({ error: "You cannot start a chat with yourself." });
            }

            try {
                const currentUser = await User.findById(currentUserId);
                if (!currentUser.friends.includes(receiverId)) {
                    return res.status(403).json({ error: "You can only chat with approved users." });
                }

                // Check if chat already exists between these two users
                let chat = await Chat.findOne({
                    isGroupChat: false,
                    users: { $all: [currentUserId, receiverId] },
                    deletedFor: { $ne: currentUserId }
                })
                    .populate('users', '-password')
                    .populate('latestMessage');

                if (chat) {
                    chat = await User.populate(chat, {
                        path: 'latestMessage.sender',
                        select: 'username avatar email'
                    });
                    return res.status(200).json(chat);
                }

                // Create new chat
                const joinedAtNow = new Date();

                const newChat = await Chat.create({
                    chatName: 'sender',
                    isGroupChat: false,
                    users: [currentUserId, receiverId],
                    members: [
                        { userId: currentUserId, joinedAt: joinedAtNow },
                        { userId: receiverId, joinedAt: joinedAtNow }
                    ],
                    deletedFor: []
                });

                const fullChat = await Chat.findById(newChat._id).populate('users', '-password');
                res.status(201).json(fullChat);

            } catch (error) {
                console.error(error.message);
                res.status(500).json({ message: 'Internal server error' });
            }
        }
    );

    // Route 2: Get all chats for logged in user
    router.get('/', fetchuser, async (req, res) => {
        try {
            const userId = req.user.id;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;

            const chats = await Chat.find({ users: userId })
                .populate('users', '-password')
                .populate('groupAdmin', '-password')
                .populate({
                    path: 'latestMessage',
                    populate: {
                        path: 'sender',
                        select: 'username avatar'
                    }
                })
                .skip((page - 1) * limit)
                .limit(limit);

            // Decrypt latestMessage content
            const decryptedChats = chats.map(chat => {
                const chatObj = chat.toObject();
                if (chatObj.latestMessage && chatObj.latestMessage.content) {
                    chatObj.latestMessage.content = decrypt(chatObj.latestMessage.content);
                }
                return chatObj;
            });

            const total = await Chat.countDocuments({ users: userId });
            const totalPages = Math.ceil(total / limit);

            res.json({ chats: decryptedChats, total, totalPages });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Route 3: Create new group chat
    router.post('/group', fetchuser, [
        body('chatName').isLength({ min: 3, max: 30 }).withMessage('Group name must be 3-30 characters'),
        body('userIds')
            .isArray({ min: 2 }).withMessage('At least 2 users required')
            .custom(ids => ids.every(id => /^[a-f\d]{24}$/i.test(id))),
        body('avatar')
            .isString()
            .notEmpty()
            .withMessage('Please select an avatar for the group'),
    ], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { chatName, userIds, avatar } = req.body;
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

            const joinedAtNow = new Date();

            const group = await Chat.create({
                chatName,
                isGroupChat: true,
                users: [...userIds, currentUserId],
                members: [...userIds, currentUserId].map(uid => ({
                    userId: uid,
                    joinedAt: joinedAtNow
                })),
                groupAdmin: currentUserId,
                deletedFor: [],
                avatar: avatar || '/avatars/hugging.png',
                permissions: {
                    rename: 'admin',
                    addUser: 'admin',
                    removeUser: 'admin'
                }
            });
            const fullChat = await Chat.findById(group._id)
                .populate('users', '-password')
                .populate('groupAdmin', '-password');

            group.users.forEach((memberId) => {
                if (memberId.toString() !== currentUserId.toString()) {
                    io.to(memberId.toString()).emit('notification', {
                        type: 'group_added',
                        message: `You were added to the group ${group.chatName}`,
                        groupId: group._id,
                        senderUsername: currentUser.username
                    });
                }
            });

            res.status(201).json(fullChat);
        } catch (err) {
            console.error(err);
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

            // Check permissions
            if (chat.permissions.rename === 'admin' && req.user.id !== chat.groupAdmin.toString()) {
                return res.status(403).json({ error: 'Only admin can rename the group' });
            }

            // If permission is 'all', anyone in the group can rename (optional: check if user is in group)
            if (chat.permissions.rename === 'all' && !chat.users.includes(req.user.id)) {
                return res.status(403).json({ error: 'You are not a member of this group' });
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
            // Fetch the group first
            const chat = await Chat.findById(req.params.id);
            if (!chat) {
                return res.status(404).json({ error: "Group not found" });
            }

            // Check permissions
            if (chat.permissions.addUser === 'admin' && !chat.groupAdmin.some(adminId => adminId.toString() === req.user.id)) {
                return res.status(403).json({ error: 'Only admin can add users' });
            }

            if (chat.permissions.addUser === 'all' && !chat.users.includes(req.user.id)) {
                return res.status(403).json({ error: 'You are not a member of this group' });
            }

            // Check friendship
            const currentUser = await User.findById(req.user.id);
            const notFriends = userIds.filter(id => !currentUser.friends.includes(id));
            if (notFriends.length > 0) {
                return res.status(403).json({ error: "All users must be your friends." });
            }

            // Filter out any users already in members
            const existingMemberIds = chat.members.map(m => m.userId.toString());
            const newJoinData = userIds
                .filter(id => !existingMemberIds.includes(id)) // skip existing members
                .map(id => ({
                    userId: id,
                    joinedAt: new Date()
                }));

            // If no one new to add
            if (newJoinData.length === 0) {
                return res.status(400).json({ error: "All provided users are already members." });
            }
            // Add users to group
            const updatedChat = await Chat.findByIdAndUpdate(
                req.params.id,
                {
                    $addToSet: { users: { $each: userIds } },
                    $push: { members: { $each: newJoinData } }
                },
                { new: true }
            ).populate('users', '-password');

            // Create system message
            const addedUsers = await User.find({ _id: { $in: userIds } });
            const addedUsernames = addedUsers.map(u => u.username).join(', ');
            const adderUsername = currentUser.username;

            const systemMessage = new Message({
                sender: null,
                content: `${adderUsername} added ${addedUsernames} to the group`,
                isSystem: true, 
            });

            await systemMessage.save();

            const populatedSystemMessage = await Message.findById(systemMessage._id).populate({
            path: "chat",
            select: "isGroupChat chatName users groupAdmin ", // add any other fields you need
            populate: {
              path: "users",
              select: "username avatar"
            }
          });

            res.json({
                message: 'Users added to group',
                isSystem:true,
                users: updatedChat.users,
                populatedSystemMessage
            });


        } catch (error) {
            console.error(error.message);
            res.status(500).send("Internal server error");
        }
    });

    // Route 6: Remove users from group (including admin leave logic)
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

            // Permission checks
            if (chat.permissions.removeUser === 'admin' && !chat.groupAdmin.some(adminId => adminId.toString() === req.user.id)) {
                return res.status(403).json({ error: 'Only admin can remove users' });
            }

            if (chat.permissions.removeUser === 'all' && !chat.users.includes(req.user.id)) {
                return res.status(403).json({ error: 'You are not a member of this group' });
            }

            // Remove users from `users`
            chat.users = chat.users.filter(id => !userIds.includes(id.toString()));

            // Remove users from `members`
            chat.members = chat.members.filter(m => !userIds.includes(m.userId.toString()));

            // Track admin count before removal
            const previousAdminCount = chat.groupAdmin.length;

            // Remove removed users from groupAdmin
            chat.groupAdmin = chat.groupAdmin.filter(adminId => !userIds.includes(adminId.toString()));

            // If exactly one admin before and now none, assign a random admin
            if (previousAdminCount === 1 && chat.groupAdmin.length === 0) {
                if (chat.users.length > 0) {
                    const randomIndex = Math.floor(Math.random() * chat.users.length);
                    chat.groupAdmin = [chat.users[randomIndex]];
                } else {
                    chat.groupAdmin = [];
                }
            }

            // Create SYSTEM MESSAGE
            const removedUsers = await User.find({ _id: { $in: userIds } });
            const removedUsernames = removedUsers.map(u => u.username).join(', ');
            console.log(removedUsers)

             const systemMessage = new Message({
                sender: null,
                content: `${removedUsernames} was removed from the group`,
                isSystem: true, 
            });

            await systemMessage.save();

            const populatedSystemMessage = await Message.findById(systemMessage._id).populate({
            path: "chat",
            select: "isGroupChat chatName users groupAdmin", // add any other fields you need
            populate: {
              path: "users",
              select: "username avatar"
            }
          });
            await chat.save();

            res.json({
                message: 'Users removed successfully.',
                isSystem:true,
                newAdmin: chat.groupAdmin,
                populatedSystemMessage,
            });

        } catch (error) {
            console.error(error.message);
            res.status(500).send("Internal server error");
        }
    });

    // Route 7: Delete chat (soft delete for current user)
    router.delete('/deletechat/:chatId', fetchuser, async (req, res) => {
        try {
            console.log('Reached DELETE /deletechat with ID:', req.params.chatId);
            console.log('User ID from token:', req.user.id);
            const chatId = req.params.chatId;
            const userId = req.user.id;

            let chat = await Chat.findById(chatId);
            if (!chat) {
                return res.status(404).json({ error: 'Chat not found' });
            }

            if (!chat.users.includes(userId)) {
                return res.status(403).json({ error: 'You are not part of this chat' });
            }

            if (!chat.deletedFor) chat.deletedFor = [];

            if (!chat.deletedFor.includes(userId)) {
                chat.deletedFor.push(userId);
                await chat.save();
            }

            res.json({ message: 'Chat deleted for you' });
        } catch (error) {
            console.error(error.message);
            res.status(500).send('Internal server error');
        }
    });

    // Route 8: Get a specific chat
    router.get('/getchat/:chatId', fetchuser, async (req, res) => {
        try {
            const chatId = req.params.chatId;
            const userId = req.user.id;

            const chat = await Chat.findOne({
                _id: chatId,
                users: userId,
                deletedFor: { $ne: userId }
            })
                .populate('users', '-password')
                .populate('latestMessage');

            if (!chat) {
                return res.status(404).json({ error: 'Chat not found or deleted' });
            }

            res.json(chat);
        } catch (error) {
            console.error(error.message);
            res.status(500).send('Internal server error');
        }
    });

    //Route 8 Update permissions
    router.put('/group-permissions/:id', fetchuser, [
        body('permissions.rename').optional().isIn(['admin', 'all']),
        body('permissions.addUser').optional().isIn(['admin', 'all']),
        body('permissions.removeUser').optional().isIn(['admin', 'all']),
    ], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { permissions } = req.body;

        try {
            const chat = await Chat.findById(req.params.id);
            if (!chat) return res.status(404).json({ error: "Group not found" });

            if (req.user.id !== chat.groupAdmin.toString()) {
                return res.status(403).json({ error: 'Only admin can update permissions' });
            }

            chat.permissions = { ...chat.permissions.toObject(), ...permissions };
            await chat.save();

            res.json({ message: 'Permissions updated', permissions: chat.permissions });
        } catch (error) {
            res.status(500).send("Internal server error");
        }
    });

    //get private chats
    router.get('/connections', fetchuser, async (req, res) => {
        try {
            const chats = await Chat.find({
                users: req.user._id,
                isGroupChat: false,
                deletedFor: { $ne: req.user.id }
            })
                .populate("users", "-password")
                .populate('wallpaper')
                .populate("latestMessage")
                .populate({
                    path: "latestMessage",
                    populate: {
                        path: "sender",
                        select: "username avatar"
                    }
                });

            const connections = await Promise.all(chats.map(async (chat) => {
                if (chat.latestMessage?.content) {
                    chat.latestMessage.content = decrypt(chat.latestMessage.content);
                }

                const otherUser = chat.users.find(
                    user => user._id.toString() !== req.user._id.toString()
                );

                // Count unread messages
                const unreadCount = await Message.countDocuments({
                    chat: chat._id,
                    sender: { $ne: req.user._id },
                    readBy: { $ne: req.user._id }
                });

                return {
                    _id: chat._id,
                    isGroupChat: false,
                    username: otherUser.username,
                    avatar: otherUser.avatar || "/avatars/laughing.png",
                    bio: otherUser.bio,
                    date: otherUser.date,
                    otherUserId: otherUser._id,
                    latestMessage: chat.latestMessage || null,
                    wallpaper: chat.wallpaper,
                    unreadCount
                };
            }));

            res.json(connections);
        } catch (err) {
            console.error(err.message);
            res.status(500).send("Internal server error");
        }
    });



    //fetching groups only with pagination
    router.get('/groups', fetchuser, async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;

            const filter = {
                users: req.user.id,
                isGroupChat: true
            };

            const total = await Chat.countDocuments(filter);

            const groups = await Chat.find({ ...filter, deletedFor: { $ne: req.user.id } })
                .populate('users', 'username avatar bio')
                .populate('groupAdmin', 'username avatar')
                .populate('wallpaper')
                .populate('permissions')
                .populate('latestMessage')
                .populate({
                    path: 'latestMessage',
                    populate: {
                        path: 'sender',
                        select: 'username avatar'
                    }
                })
                .sort({ updatedAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit);


            const formattedGroups = await Promise.all(groups.map(async (chat) => {
                if (chat.latestMessage?.content) {
                    chat.latestMessage.content = decrypt(chat.latestMessage.content);
                }


                // Count unread messages
                const unreadCount = await Message.countDocuments({
                    chat: chat._id,
                    sender: { $ne: req.user._id },
                    readBy: { $ne: req.user._id }
                });

                return {
                    _id: chat._id,
                    chatName: chat.chatName,
                    avatar: chat.avatar,
                    users: chat.users,
                    groupAdmin: chat.groupAdmin,
                    latestMessage: chat.latestMessage || null,
                    isGroupChat: true,
                    permissions: chat.permissions,
                    unreadCount
                };
            }));



            res.json({
                groups: formattedGroups,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit)
                }
            });
        } catch (err) {
            console.error(err.message);
            res.status(500).send("Internal server error");
        }
    });

    // PUT /api/chat/:chatId/wallpaper
    router.put('/:chatId/wallpaper', fetchuser, async (req, res) => {
        try {
            const { url, senderbubble, receiverbubble } = req.body;

            const chat = await Chat.findById(req.params.chatId);

            if (!chat) return res.status(404).json({ error: 'Chat not found' });

            if (!chat.users.includes(req.user.id)) {
                return res.status(403).json({ error: 'Unauthorized' });
            }

            // Update wallpaper
            chat.wallpaper = {
                url,
                senderbubble,
                receiverbubble,
            };
            await chat.save();

            // Send system message
            const user = await User.findById(req.user.id);
            const systemMsg = new Message({
                sender: req.user.id,
                chat: chat._id,
                content: `🖼️ ${user.username} changed the wallpaper.`,
                isSystem: true,
            });
            await systemMsg.save();

            // Update latestMessage reference
            chat.latestMessage = systemMsg._id;
            await chat.save();

            res.json({ success: true, wallpaper: chat.wallpaper });
        } catch (err) {
            console.log(req.body)
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    });


    // make another user admin
    router.put('/chats/:chatId/make-admin/:userId', fetchuser, async (req, res) => {
        try {
            const { chatId, userId } = req.params;
            const userRequesting = req.user.id; // logged-in user ID

            const chat = await Chat.findById(chatId);
            if (!chat) return res.status(404).json({ error: 'Chat not found' });

            // Only existing admins can add new admins
            if (!chat.groupAdmin.some(adminId => adminId.toString() === userRequesting)) {
                return res.status(403).json({ error: 'Only admins can make other users admins' });
            }

            // Check if userId is in the group members
            if (!chat.users.some(u => u.toString() === userId)) {
                return res.status(400).json({ error: 'User is not a member of this group' });
            }

            // If user is already admin
            if (chat.groupAdmin.some(adminId => adminId.toString() === userId)) {
                return res.status(400).json({ error: 'User is already an admin' });
            }

            // Add userId to admins
            chat.groupAdmin.push(userId);
            await chat.save();

            res.json({ message: 'User promoted to admin', groupAdmin: chat.groupAdmin });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
};
