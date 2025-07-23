const express = require("express");
//const User = require('../models/User');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fetchuser = require('../middleware/fetchuser');
const User = require("../models/User");
const Notification = require("../models/Notification");

//const Notification = require("../models/Notification");
require('dotenv').config({ path: '.env.local' });
const JWT_SECRET = process.env.JWT_SECRET;

module.exports = (io) => {
	// ROUTE 1: Create a user using POST "/api/auth/register"
	router.post('/register', [
		body('username', 'Enter a valid name').isLength({ min: 3 }),
		body('email', 'Enter a valid email').isEmail(),
		body('password', 'Password must be at least 8 characters').isLength({ min: 8 }),
	], async (req, res) => {
		let success = false;
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ success, errors: errors.array() });
		}

		try {
			let user = await User.findOne({ email: req.body.email });
			let user_name = await User.findOne({ username: req.body.username });

			if (user) {
				return res.status(400).json({ success, error: "User with this email already exists." });
			}
			if (user_name) {
				return res.status(400).json({ success, error: "User with this username already exists." });
			}

			const salt = await bcrypt.genSalt(10);
			const secPass = await bcrypt.hash(req.body.password, salt);

			user = await User.create({
				username: req.body.username,
				email: req.body.email,
				password: secPass
			});

			const data = {
				user: {
					id: user.id
				}
			};

			const authToken = jwt.sign(data, JWT_SECRET);
			success = true;
			res.json({ success, authToken, user });

		} catch (error) {
			console.error(error.message);
			res.status(500).send("Internal server error");
		}
	});

	// ROUTE 2: Authenticate a user using POST "/api/auth/login"
	router.post('/login', [
		body('email', 'Enter a valid email').isEmail(),
		body('password', 'Password cannot be blank').exists()
	], async (req, res) => {
		let success = false;
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			return res.status(400).json({ success, errors: errors.array() });
		}

		const { email, password } = req.body;

		try {
			let user = await User.findOne({ email });

			if (!user) {
				return res.status(400).json({ success: false, error: "Invalid credentials" });
			}

			const passwordCompare = await bcrypt.compare(password, user.password);
			if (!passwordCompare) {
				console.log('user:', user);
				return res.status(400).json({ success: false, error: "Invalid credentials" });
			}

			const data = {
				user: {
					id: user.id
				}
			};

			const authToken = jwt.sign(data, JWT_SECRET);
			success = true;
			res.json({ success, authToken, user });
		} catch (error) {
			console.error(error.message);
			res.status(500).send("Internal server error");
		}
	});

	// ROUTE 3: Get logged-in user details using POST "/api/auth/getuser". Login required.
	router.post('/getuser', fetchuser, async (req, res) => {
		try {
			const userId = req.user.id;
			// Populate friends field (if it contains user references)
			const user = await User.findById(userId)
				.select("-password")
				.populate('friends', '_id');  // get just ids of friends

			if (!user) {
				return res.status(404).json({ success: false, error: 'User not found' });
			}

			// Map friends to their _id strings
			const friendsIds = user.friends ? user.friends.map(friend => friend._id.toString()) : [];

			res.json({
				success: true,
				user: {
					...user.toObject(),
					friends: friendsIds,
				}
			});
		} catch (error) {
			console.error(error.message);
			res.status(500).send("Internal server error");
		}
	});


	// ROUTE 4: Get other user details (limited data)
	router.post('/getanotheruser/:userId', fetchuser, async (req, res) => {
		try {
			const userId = req.params.userId;
			const user = await User.findById(userId).select("avatar username bio date");

			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			res.json(user);
		} catch (error) {
			console.error(error.message);
			res.status(500).send("Internal server error");
		}
	});

	// ROUTE 5: Update profile (username, bio, avatar)
	router.put('/update-profile', fetchuser, async (req, res) => {
		const { username, bio, avatar } = req.body;

		try {
			const updates = {};
			if (username) updates.username = username;
			if (bio) updates.bio = bio;
			if (avatar) updates.avatar = avatar;

			const updatedUser = await User.findByIdAndUpdate(
				req.user.id,
				{ $set: updates },
				{ new: true }
			).select('-password');

			res.json({ success: true, user: updatedUser });
		} catch (error) {
			console.error(error.message);
			res.status(500).json({ error: "Internal server error" });
		}
	});

	// ROUTE 6: Send friend request 
	router.post('/send-request/:id', fetchuser, async (req, res) => {
		try {
			const senderId = req.user.id;
			const receiverId = req.params.id;

			if (senderId === receiverId) {
				return res.status(400).json({ error: 'Cannot send request to yourself' });
			}

			const sender = await User.findById(senderId);
			const receiver = await User.findById(receiverId);

			if (!receiver) {
				return res.status(404).json({ error: 'User not found' });
			}

			// Initialize arrays if undefined
			if (!Array.isArray(sender.sentRequests)) sender.sentRequests = [];
			if (!Array.isArray(receiver.pendingRequests)) receiver.pendingRequests = [];

			// Check if request already sent
			if (sender.sentRequests.some(id => id.toString() === receiverId)) {
				return res.status(400).json({ error: 'Request already sent' });
			}
			if (receiver.pendingRequests.some(id => id.toString() === senderId)) {
				return res.status(400).json({ error: 'Request already sent' });
			}

			// Push ids into respective arrays
			sender.sentRequests.push(receiverId);
			receiver.pendingRequests.push(senderId);

			await sender.save();
			await receiver.save();

			// Create notification
			const notification = new Notification({
				type: 'friend_request',
				recipientId: receiverId,
				senderId,
				senderUsername: sender.username,
				user: senderId
			});
			await notification.save();

			// Emit socket notification
			const io = req.app.get('io');
			io.to(receiverId).emit('notification', {
				type: 'friend_request',
				senderId,
				senderUsername: sender.username,
				message: `${sender.username} sent you a friend request`,
				chatId: null,
				createdAt: new Date()
			});

			res.json({ success: true, message: 'Friend request sent' });
		} catch (err) {
			console.error(err);
			res.status(500).json({ error: 'Internal server error' });
		}
	});

	// ROUTE 7: Accept friend request
	router.post('/accept-request/:id', fetchuser, async (req, res) => {
		try {
			const receiverId = req.user.id;
			const senderId = req.params.id;

			if (receiverId === senderId) {
				return res.status(400).json({ error: 'Invalid operation' });
			}

			const receiver = await User.findById(receiverId);
			const sender = await User.findById(senderId);

			if (!receiver || !sender) {
				return res.status(404).json({ error: 'User not found' });
			}

			// Initialize arrays if undefined
			if (!Array.isArray(receiver.pendingRequests)) receiver.pendingRequests = [];
			if (!Array.isArray(sender.sentRequests)) sender.sentRequests = [];
			if (!Array.isArray(receiver.friends)) receiver.friends = [];
			if (!Array.isArray(sender.friends)) sender.friends = [];

			// Remove request from pendingRequests and sentRequests
			receiver.pendingRequests = receiver.pendingRequests.filter(id => id.toString() !== senderId);
			sender.sentRequests = sender.sentRequests.filter(id => id.toString() !== receiverId);

			// Add friends (avoid duplicates)
			if (!receiver.friends.some(id => id.toString() === senderId)) receiver.friends.push(senderId);
			if (!sender.friends.some(id => id.toString() === receiverId)) sender.friends.push(receiverId);

			await receiver.save();
			await sender.save();

			// Notification about acceptance
			const notification = new Notification({
				type: 'request_accepted',
				recipientId: senderId,       // Who will receive this notification (sender)
				senderId: receiverId,        // Who performed the action (receiver)
				senderUsername: receiver.username,
				message: `${receiver.username} accepted your friend request`, // You can add this field if your schema supports it
				createdAt: new Date()
			});
			await notification.save();

			// Emit socket notification to sender
			const io = req.app.get('io');
			io.to(senderId).emit('notification', {
				type: 'request_accepted',
				senderId: receiverId,
				senderUsername: receiver.username,
				message: `${receiver.username} accepted your friend request`,
				chatId: null,
				createdAt: new Date()
			});

			res.json({ success: true, message: 'Friend request accepted' });
		} catch (err) {
			console.error(err);
			res.status(500).json({ error: 'Internal server error' });
		}
	});

	// ROUTE 8: Reject friend request
	router.post('/reject-request/:senderId', fetchuser, async (req, res) => {
		try {
			const receiverId = req.user.id;
			const { senderId } = req.params;

			const receiver = await User.findById(receiverId);
			const sender = await User.findById(senderId);

			if (!receiver || !sender) {
				return res.status(404).json({ error: 'User does not exist!' });
			}

			if (!Array.isArray(receiver.pendingRequests)) receiver.pendingRequests = [];
			if (!Array.isArray(sender.sentRequests)) sender.sentRequests = [];

			if (!receiver.pendingRequests.some(id => id.toString() === senderId)) {
				return res.status(404).json({ error: 'No such request exists!' });
			}

			// Remove senderId from receiver.pendingRequests and receiverId from sender.sentRequests
			receiver.pendingRequests = receiver.pendingRequests.filter(id => id.toString() !== senderId);
			sender.sentRequests = sender.sentRequests.filter(id => id.toString() !== receiverId);

			await receiver.save();
			await sender.save();

			res.json({ success: true, message: 'Friend request rejected' });
		} catch (error) {
			console.error(error.message);
			res.status(500).send("Internal server error");
		}
	});

	// ROUTE 9: Update avatar
	router.put('/avatar', fetchuser, async (req, res) => {
		const { avatar } = req.body;

		if (!avatar) {
			return res.status(400).json({ error: 'Avatar URL is required' });
		}

		try {
			const user = await User.findById(req.user.id);
			user.avatar = avatar;
			await user.save();

			res.json({ success: true, avatar: user.avatar });
		} catch (error) {
			console.error('Error updating avatar:', error.message);
			res.status(500).json({ error: 'Server error while updating avatar' });
		}
	});

	// ROUTE 10: Get all users except logged-in user, paginated
	router.get('/allusers', fetchuser, async (req, res) => {
		try {
			const loggedInUserId = req.user.id;

			const page = Math.max(parseInt(req.query.page) || 1, 1);
			const limit = Math.min(Math.max(parseInt(req.query.limit) || 4, 1), 50);
			const skip = (page - 1) * limit;

			const totalUsers = await User.countDocuments({ _id: { $ne: loggedInUserId } });

			const users = await User.find({ _id: { $ne: loggedInUserId } })
				.select('avatar username bio date')
				.sort({ username: 1 })  // consistent order
				.skip(skip)
				.limit(limit);

			res.json({
				success: true,
				users,
				pagination: {
					totalUsers,
					currentPage: page,
					totalPages: Math.ceil(totalUsers / limit),
					pageSize: users.length,
				}
			});
		} catch (error) {
			console.error(error.message);
			res.status(500).send("Internal server error");
		}
	});


	// ROUTE 11: Cancel friend request
	router.post('/cancel-request/:receiverId', fetchuser, async (req, res) => {
		try {
			const senderId = req.user.id;
			const receiverId = req.params.receiverId;

			const receiver = await User.findById(receiverId);
			const sender = await User.findById(senderId);

			if (!receiver || !sender) {
				return res.status(404).json({ error: 'User not found' });
			}

			if (!receiver.pendingRequests.includes(senderId)) {
				return res.status(400).json({ error: 'No pending request to cancel' });
			}

			receiver.pendingRequests = receiver.pendingRequests.filter(id => id.toString() !== senderId);
			await receiver.save();

			sender.sentRequests = (sender.sentRequests || []).filter(id => id.toString() !== receiverId);
			await sender.save();

			res.json({ success: true, message: 'Friend request cancelled' });
		} catch (error) {
			console.error(error.message);
			res.status(500).send('Internal server error');
		}
	});


	// GET /api/friendrequests - Get pending friend requests for logged-in user
	router.get('/friendrequests', fetchuser, async (req, res) => {
		try {
			const userId = req.user.id;

			// Find user and populate pendingRequests with basic user info
			const user = await User.findById(userId)
				.populate('pendingRequests', 'username avatar email');

			if (!user) {
				return res.status(404).json({ success: false, error: 'User not found' });
			}

			res.json({ success: true, pendingRequests: user.pendingRequests });
		} catch (error) {
			console.error('Error fetching friend requests:', error);
			res.status(500).json({ success: false, error: 'Server error' });
		}
	});

	// GET /api/auth/sent-requests
	// Returns: { success: true, sentRequests: [userId1, userId2, ...] }
	router.get('/sent-requests', fetchuser, async (req, res) => {
		try {
			const user = await User.findById(req.user.id).select('sentRequests');
			if (!user) return res.status(404).json({ success: false, error: "User not found" });

			res.json({ success: true, sentRequests: user.sentRequests || [] });
		} catch (err) {
			console.error(err);
			res.status(500).json({ success: false, error: "Internal server error" });
		}
	});


	//get friends
	router.get('/friends', fetchuser, async (req, res) => {
		try {
			const user = await User.findById(req.user.id).populate('friends', 'avatar username bio');
			res.json(user.friends);
		} catch (err) {
			console.error(err.message);
			res.status(500).send('Server Error');
		}
	});

	//remove friend
	router.post('/removefriends/:toRemoveId', fetchuser, async (req, res) => {
		try {
			const userId = req.user.id;
			const toRemoveId = req.params.toRemoveId;

			const toRemove = await User.findById(toRemoveId);
			const user = await User.findById(userId);

			if (!toRemove || !user) {
				return res.status(404).json({ error: 'User not found' });
			}

			// Fix comparison here
			if (!user.friends.map(id => id.toString()).includes(toRemoveId)) {
				return res.status(400).json({ error: 'Not a friend' });
			}

			user.friends = user.friends.filter(id => id.toString() !== toRemoveId);
			await user.save();

			toRemove.friends = (toRemove.friends || []).filter(id => id.toString() !== userId);
			await toRemove.save();

			res.json({ success: true, message: 'Removed from friend list' });
		} catch (error) {
			console.error(error.message);
			res.status(500).send('Internal server error');
		}
	});



	return router;
};

