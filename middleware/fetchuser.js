const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Make sure path is correct
require('dotenv').config({ path: '.env.local' });
const JWT_SECRET = process.env.JWT_SECRET;

const fetchuser = async (req, res, next) => {
  const token = req.header('auth-token');
  if (!token) {
    return res.status(401).send({ error: 'Please authenticate using a valid token' });
  }

  try {
    const data = jwt.verify(token, JWT_SECRET);

    const user = await User.findById(data.user.id); // data.user.id if you stored { user: { id } } in token
    if (!user) {
      return res.status(404).send({ error: 'User not found' });
    }

    req.user = user; // Attach full user document to request
    next();
  } catch (error) {
    console.error(error.message);
    res.status(401).send({ error: 'Please authenticate using a valid token' });
  }
};

module.exports = fetchuser;
