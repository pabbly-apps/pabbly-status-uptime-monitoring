import { OAuth2Client } from 'google-auth-library';
import { query } from '../config/database.js';
import { generateAccessToken } from '../middleware/auth.js';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Helper: get allowed domains from system_settings
const getAllowedDomains = async () => {
  const result = await query('SELECT allowed_domains FROM system_settings WHERE id = 1');
  const raw = result.rows[0]?.allowed_domains || '*';
  if (raw.trim() === '*') return null; // null means all domains allowed
  return raw.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
};

// Helper: check if an email's domain is in the allowed list
const isDomainAllowed = (email, allowedDomains) => {
  if (!allowedDomains) return true; // '*' — all domains allowed
  const domain = email.split('@')[1]?.toLowerCase();
  return allowedDomains.includes(domain);
};

// Google SSO login
export const googleLogin = async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Google credential is required',
      });
    }

    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    // Check domain against configured allowed domains
    const allowedDomains = await getAllowedDomains();

    if (!isDomainAllowed(email, allowedDomains)) {
      const domainList = allowedDomains.join(', ');
      return res.status(403).json({
        error: 'Access denied',
        message: `Only accounts from allowed domains (${domainList}) can sign in`,
      });
    }

    // Check if user exists and is allowed
    const result = await query(
      'SELECT id, email, full_name, google_id, profile_picture, is_active, last_login FROM admin_user WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Your account has not been added by an administrator. Please contact an admin.',
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        error: 'Account disabled',
        message: 'Your account has been deactivated. Please contact an administrator.',
      });
    }

    // Update user with Google info (first-time or subsequent logins)
    await query(
      `UPDATE admin_user
       SET google_id = $1, full_name = $2, profile_picture = $3,
           last_login = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [googleId, name, picture, user.id]
    );

    // Generate JWT (same mechanism as before)
    const token = generateAccessToken({
      id: user.id,
      email: user.email,
    });

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email,
        full_name: name,
        profile_picture: picture,
        last_login: user.last_login,
      },
    });
  } catch (error) {
    console.error('Google login error:', error);
    if (error.message?.includes('Token used too late') || error.message?.includes('Invalid token')) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Google token is invalid or expired. Please try again.',
      });
    }
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred during Google authentication',
    });
  }
};

// Logout (client-side token removal)
export const logout = async (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully',
  });
};

// Verify token
export const verifyToken = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      'SELECT id, email, full_name, profile_picture, last_login FROM admin_user WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found',
        message: 'Admin user does not exist',
      });
    }

    res.json({
      success: true,
      valid: true,
      user: result.rows[0],
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred during token verification',
    });
  }
};

// Get admin profile
export const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      'SELECT id, email, full_name, profile_picture, created_at, last_login FROM admin_user WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found',
        message: 'Admin user does not exist',
      });
    }

    res.json({
      success: true,
      profile: result.rows[0],
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'An error occurred while fetching profile',
    });
  }
};

// Get all users (for user management)
export const getUsers = async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.full_name, u.profile_picture, u.is_active, u.created_at, u.last_login,
              adder.full_name AS added_by_name, adder.email AS added_by_email
       FROM admin_user u
       LEFT JOIN admin_user adder ON u.added_by = adder.id
       ORDER BY u.created_at ASC`
    );

    res.json({
      success: true,
      users: result.rows,
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch users',
    });
  }
};

// Add a new allowed user (pre-registration for Google SSO)
export const addUser = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Email is required',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Validate against configured allowed domains
    const allowedDomains = await getAllowedDomains();

    if (!isDomainAllowed(normalizedEmail, allowedDomains)) {
      const domainList = allowedDomains.join(', ');
      return res.status(400).json({
        error: 'Validation error',
        message: `Only email addresses from allowed domains (${domainList}) can be added`,
      });
    }

    // Check if already exists
    const existing = await query('SELECT id FROM admin_user WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'User with this email already exists',
      });
    }

    const addedBy = req.user.id;

    const result = await query(
      'INSERT INTO admin_user (email, added_by, is_active) VALUES ($1, $2, TRUE) RETURNING id, email, is_active, created_at',
      [normalizedEmail, addedBy]
    );

    res.status(201).json({
      success: true,
      message: 'User added successfully',
      user: result.rows[0],
    });
  } catch (error) {
    console.error('Add user error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to add user',
    });
  }
};

// Remove a user
export const removeUser = async (req, res) => {
  try {
    const { id } = req.params;
    const requestingUserId = req.user.id;

    // Prevent self-deletion
    if (parseInt(id) === requestingUserId) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'You cannot remove your own account',
      });
    }

    const result = await query(
      'DELETE FROM admin_user WHERE id = $1 RETURNING id, email',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'User not found',
      });
    }

    res.json({
      success: true,
      message: 'User removed successfully',
    });
  } catch (error) {
    console.error('Remove user error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to remove user',
    });
  }
};
