const express = require("express");
const User = require('../models/User');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
var jwt = require('jsonwebtoken');
const fetchuser = require('../middleware/fetchuser');
require('dotenv').config({ path: '.env.local' });
const JWT_SECRET = process.env.JWT_SECRET;


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
			let success = false;
			return res.status(400).json({ success, error: "User with this email already exists." });
		}
		if (user_name) {
			let success = false;
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
		const success = true;
		res.json({ success, authToken });

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
		const success = false;
		return res.status(400).json({ success, errors: errors.array() });
	}

	const { email, password } = req.body;

	try {
		let user = await User.findOne({ email });

		if (!user) {
			const success = false;
			return res.status(400).json({ success, error: "Invalid credentials" });
		}

		const passwordCompare = await bcrypt.compare(password, user.password);
		if (!passwordCompare) {
			const success = false;
			return res.status(400).json({ success, error: "Invalid credentials" });
		}

		const data = {
			user: {
				id: user.id
			}
		};

		const authToken = jwt.sign(data, JWT_SECRET);
		const success = true;
		res.json({ success, authToken });


	} catch (error) {
		console.error(success, error.message);
		res.status(500).send("Internal server error");
	}
});

//Route 3: Get loggedin user details using: POST"/api/auth/getuser. Login required.
router.post('/getuser', fetchuser, async (req, res) => {

	try {
		const userId = req.user.id;
		const user = await User.findById(userId).select("-password")
		res.send(user);
	} catch (error) {
		console.error(error.message);
		res.status(500).send("Internal server error");
	}
});

//Route 4: get user details of other user (limited data)
router.post('/getanotheruser/:username', fetchuser, async (req, res) => {

	try {
		const username = req.params.username;
		const user = await User.findOne({ username }).select("username bio date");
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		res.json(user);

	} catch (error) {
		console.error(error.message);
		res.status(500).send("Internal server error");
	}
});
 //combined profile update
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

//route 6:  Send Request
router.post('/send-request/:receiverId', fetchuser, async (req, res) => {
	try {
		const senderId = req.user.id;
		const receiverId = req.params.receiverId;

		if (senderId === receiverId) {
			return res.status(400).json({ error: 'You cannot send request to yourself!' });
		}

		const receiver = await User.findById(receiverId);
		if (!receiver) {
			return res.status(404).json({ error: "User not found!" });
		}

		if (receiver.friends.includes(senderId)) {
			return res.status(400).json({ error: "Already friends!" });
		}

		if (receiver.pendingRequests.includes(senderId)) {
			return res.status(400).json({ error: "Request already sent!" });
		}

		receiver.pendingRequests.push(senderId);
		await receiver.save();

		res.json({ success: true, message: 'Friend request sent' });
	} catch (error) {
		console.error(error.message);
		res.status(500).send("Internal server error");
	}
});

//Route 7 : Accept Request
router.post('/accept-request/:senderId', fetchuser, async (req, res) => {
	try {
		const { senderId } = req.params;
		const receiverId = req.user.id;

		const receiver = await User.findById(receiverId);
		const sender = await User.findById(senderId);

		if (!sender || !receiver) {
			return res.status(404).json({ error: 'User does not exist!' });
		}

		if (!receiver.pendingRequests.includes(senderId)) {
			return res.status(404).json({ error: 'No such request exists!' });
		}

		// Add each other as friends 
		receiver.friends.push(sender._id);
		sender.friends.push(receiver._id);

		// Remove senderId from receiver's pendingRequests
		receiver.pendingRequests = receiver.pendingRequests.filter(
			id => id.toString() !== senderId
		);

		// Save both
		await receiver.save();
		await sender.save();

		res.json({ success: true, message: "Friend request accepted" });

	} catch (error) {
		console.error(error.message);
		res.status(500).send("Internal server error");
	}
});


//Route :8 Reject Request
router.post('/reject-request/:senderId', fetchuser, async (req, res) => {
	try {
		const receiverId = req.user.id;
		const { senderId } = req.params;

		const receiver = await User.findById(receiverId);
		const sender = await User.findById(senderId);

		if (!sender || !receiver) {
			return res.status(404).json({ error: 'User does not exist!' });
		}

		if (!receiver.pendingRequests.includes(senderId)) {
			return res.status(404).json({ error: 'No such request exists!' });
		}

		receiver.pendingRequests = receiver.pendingRequests.filter(id => id.toString() !== senderId);

		receiver.save();

		res.json({ success: true, message: 'Friend request Rejected' })

	} catch (error) {
		console.error(error.message);
		res.status(500).send("Internal server error");
	}
})

//edit avatar
router.put('/avatar', fetchuser, async (req, res) => {
  const { avatar } = req.body;

  if (!avatar) {
    return res.status(400).json({ error: 'Avatar URL is required' });
  }

  try {
    // Assuming fetchuser middleware sets req.user to the logged-in user document
    req.user.avatar = avatar;
    await req.user.save();

    res.json({ success: true, avatar: req.user.avatar });
  } catch (error) {
    console.error('Error updating avatar:', error.message);
    res.status(500).json({ error: 'Server error while updating avatar' });
  }
});

module.exports = router;




module.exports = router;
