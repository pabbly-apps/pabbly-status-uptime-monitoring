import { query, getClient } from '../config/database.js';
import { testWebhook as testWebhookService } from '../services/webhookService.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================
// API MANAGEMENT
// ============================================

// Get all monitored APIs
export const getAllAPIs = async (req, res) => {
  try {
    const result = await query(`
      SELECT
        a.*,
        g.name as group_name,
        g.display_order as group_order,
        (
          SELECT status
          FROM ping_logs
          WHERE api_id = a.id
          ORDER BY pinged_at DESC
          LIMIT 1
        ) as last_status,
        (
          SELECT pinged_at
          FROM ping_logs
          WHERE api_id = a.id
          ORDER BY pinged_at DESC
          LIMIT 1
        ) as last_checked
      FROM apis a
      LEFT JOIN api_groups g ON a.group_id = g.id
      ORDER BY g.display_order ASC, a.display_order ASC, a.id ASC
    `);

    // Mark as 'pending' if no pings exist yet
    result.rows.forEach(api => {
      if (!api.last_status) {
        api.last_status = 'pending';
      }
    });

    res.json({
      success: true,
      count: result.rows.length,
      apis: result.rows,
    });
  } catch (error) {
    console.error('Get all APIs error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch APIs',
    });
  }
};

// Get single API details
export const getAPIById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM apis WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'API not found',
      });
    }

    res.json({
      success: true,
      api: result.rows[0],
    });
  } catch (error) {
    console.error('Get API by ID error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch API details',
    });
  }
};

// Create new API to monitor
export const createAPI = async (req, res) => {
  try {
    const {
      name,
      url,
      monitoring_interval = 60,
      expected_status_code = 200,
      timeout_duration = 30000,
      is_active = true,
      is_public = true,
      group_id,
    } = req.body;

    // Validation
    if (!name || !url) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Name and URL are required',
      });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Invalid URL format',
      });
    }

    // If no group_id provided, assign to default group
    let finalGroupId = group_id;
    if (!finalGroupId) {
      const defaultGroupResult = await query(
        'SELECT id FROM api_groups WHERE is_default = TRUE LIMIT 1'
      );
      if (defaultGroupResult.rows.length > 0) {
        finalGroupId = defaultGroupResult.rows[0].id;
      }
    }

    const result = await query(
      `INSERT INTO apis (name, url, monitoring_interval, expected_status_code, timeout_duration, is_active, is_public, group_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name, url, monitoring_interval, expected_status_code, timeout_duration, is_active, is_public, finalGroupId]
    );

    res.status(201).json({
      success: true,
      message: 'API added successfully',
      api: result.rows[0],
    });
  } catch (error) {
    console.error('Create API error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to create API',
    });
  }
};

// Update API configuration
export const updateAPI = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      url,
      monitoring_interval,
      expected_status_code,
      timeout_duration,
      is_active,
      is_public,
      group_id,
    } = req.body;

    // Check if API exists
    const checkResult = await query('SELECT id FROM apis WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'API not found',
      });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }

    if (url !== undefined) {
      // Validate URL
      try {
        new URL(url);
      } catch (e) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Invalid URL format',
        });
      }
      updates.push(`url = $${paramCount}`);
      values.push(url);
      paramCount++;
    }

    if (monitoring_interval !== undefined) {
      updates.push(`monitoring_interval = $${paramCount}`);
      values.push(monitoring_interval);
      paramCount++;
    }

    if (expected_status_code !== undefined) {
      updates.push(`expected_status_code = $${paramCount}`);
      values.push(expected_status_code);
      paramCount++;
    }

    if (timeout_duration !== undefined) {
      updates.push(`timeout_duration = $${paramCount}`);
      values.push(timeout_duration);
      paramCount++;
    }

    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCount}`);
      values.push(is_active);
      paramCount++;
    }

    if (is_public !== undefined) {
      updates.push(`is_public = $${paramCount}`);
      values.push(is_public);
      paramCount++;
    }

    if (group_id !== undefined) {
      updates.push(`group_id = $${paramCount}`);
      values.push(group_id);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        error: 'No updates provided',
        message: 'Please provide at least one field to update',
      });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const updateQuery = `
      UPDATE apis
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await query(updateQuery, values);

    res.json({
      success: true,
      message: 'API updated successfully',
      api: result.rows[0],
    });
  } catch (error) {
    console.error('Update API error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to update API',
    });
  }
};

// Delete API
export const deleteAPI = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM apis WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'API not found',
      });
    }

    res.json({
      success: true,
      message: 'API deleted successfully',
      api: result.rows[0],
    });
  } catch (error) {
    console.error('Delete API error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to delete API',
    });
  }
};

// ============================================
// DASHBOARD STATS
// ============================================

export const getDashboardStats = async (req, res) => {
  try {
    // Total APIs
    const totalAPIs = await query('SELECT COUNT(*) as count FROM apis');

    // Active APIs
    const activeAPIs = await query('SELECT COUNT(*) as count FROM apis WHERE is_active = true');

    // Currently down APIs (last ping was failure)
    const downAPIs = await query(`
      SELECT COUNT(DISTINCT api_id) as count
      FROM ping_logs p1
      WHERE status IN ('failure', 'timeout')
      AND pinged_at = (
        SELECT MAX(pinged_at)
        FROM ping_logs p2
        WHERE p2.api_id = p1.api_id
      )
    `);

    // Total pings today
    const pingsToday = await query(`
      SELECT COUNT(*) as count
      FROM ping_logs
      WHERE DATE(pinged_at) = CURRENT_DATE
    `);

    // Average uptime (last 24h)
    const avgUptime = await query(`
      SELECT AVG(uptime_percentage) as avg_uptime
      FROM uptime_summaries
      WHERE period = '24h'
    `);

    // Recent incidents
    const recentIncidents = await query(`
      SELECT COUNT(*) as count
      FROM incidents
      WHERE status != 'resolved'
    `);

    // System settings (for logo and branding)
    const settings = await query('SELECT * FROM system_settings WHERE id = 1');

    res.json({
      success: true,
      stats: {
        total_apis: parseInt(totalAPIs.rows[0].count),
        active_apis: parseInt(activeAPIs.rows[0].count),
        apis_down: parseInt(downAPIs.rows[0].count),
        total_pings_today: parseInt(pingsToday.rows[0].count),
        avg_uptime: parseFloat(avgUptime.rows[0].avg_uptime || 0).toFixed(2),
        open_incidents: parseInt(recentIncidents.rows[0].count),
      },
      settings: settings.rows[0] || {},
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch dashboard statistics',
    });
  }
};

// ============================================
// LOGS & ANALYTICS
// ============================================

export const getPingLogs = async (req, res) => {
  try {
    const { apiId } = req.params;
    const { limit = 100, offset = 0 } = req.query;

    const result = await query(
      `SELECT * FROM ping_logs
       WHERE api_id = $1
       ORDER BY pinged_at DESC
       LIMIT $2 OFFSET $3`,
      [apiId, limit, offset]
    );

    const countResult = await query(
      'SELECT COUNT(*) as total FROM ping_logs WHERE api_id = $1',
      [apiId]
    );

    res.json({
      success: true,
      total: parseInt(countResult.rows[0].total),
      logs: result.rows,
    });
  } catch (error) {
    console.error('Get ping logs error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch ping logs',
    });
  }
};

export const getAPIAnalytics = async (req, res) => {
  try {
    const { apiId } = req.params;

    // Get uptime summaries
    const uptimeSummaries = await query(
      `SELECT * FROM uptime_summaries
       WHERE api_id = $1
       ORDER BY period`,
      [apiId]
    );

    // Get recent ping statistics
    const recentStats = await query(
      `SELECT
        COUNT(*) as total_pings,
        COUNT(*) FILTER (WHERE status = 'success') as successful_pings,
        COUNT(*) FILTER (WHERE status = 'failure') as failed_pings,
        AVG(response_time) as avg_response_time,
        MIN(response_time) as min_response_time,
        MAX(response_time) as max_response_time
       FROM ping_logs
       WHERE api_id = $1
       AND pinged_at >= NOW() - INTERVAL '24 hours'`,
      [apiId]
    );

    // Get hourly response times (last 24 hours)
    const hourlyData = await query(
      `SELECT
        DATE_TRUNC('hour', pinged_at) as hour,
        AVG(response_time) as avg_response_time,
        COUNT(*) as ping_count,
        COUNT(*) FILTER (WHERE status = 'success') as success_count
       FROM ping_logs
       WHERE api_id = $1
       AND pinged_at >= NOW() - INTERVAL '24 hours'
       GROUP BY hour
       ORDER BY hour`,
      [apiId]
    );

    res.json({
      success: true,
      analytics: {
        uptime_summaries: uptimeSummaries.rows,
        recent_stats: recentStats.rows[0],
        hourly_data: hourlyData.rows,
      },
    });
  } catch (error) {
    console.error('Get API analytics error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch analytics',
    });
  }
};

// ============================================
// INCIDENTS
// ============================================

export const getIncidents = async (req, res) => {
  try {
    const { status } = req.query;

    let queryText = `
      SELECT i.*, a.name as api_name
      FROM incidents i
      JOIN apis a ON i.api_id = a.id
    `;

    const values = [];
    if (status) {
      queryText += ' WHERE i.status = $1';
      values.push(status);
    }

    queryText += ' ORDER BY i.started_at DESC';

    const result = await query(queryText, values);

    res.json({
      success: true,
      count: result.rows.length,
      incidents: result.rows,
    });
  } catch (error) {
    console.error('Get incidents error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch incidents',
    });
  }
};

export const createIncident = async (req, res) => {
  try {
    const { api_id, title, description, status = 'ongoing' } = req.body;

    if (!api_id || !title) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'API ID and title are required',
      });
    }

    const result = await query(
      `INSERT INTO incidents (api_id, title, description, status, started_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       RETURNING *`,
      [api_id, title, description, status]
    );

    res.status(201).json({
      success: true,
      message: 'Incident created successfully',
      incident: result.rows[0],
    });
  } catch (error) {
    console.error('Create incident error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to create incident',
    });
  }
};

export const updateIncident = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, status } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (title) {
      updates.push(`title = $${paramCount}`);
      values.push(title);
      paramCount++;
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount}`);
      values.push(description);
      paramCount++;
    }

    if (status) {
      updates.push(`status = $${paramCount}`);
      values.push(status);
      paramCount++;

      // If status is 'resolved', set resolved_at timestamp
      if (status === 'resolved') {
        updates.push(`resolved_at = CURRENT_TIMESTAMP`);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        error: 'No updates provided',
        message: 'Please provide at least one field to update',
      });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const updateQuery = `
      UPDATE incidents
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await query(updateQuery, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Incident not found',
      });
    }

    res.json({
      success: true,
      message: 'Incident updated successfully',
      incident: result.rows[0],
    });
  } catch (error) {
    console.error('Update incident error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to update incident',
    });
  }
};

export const deleteIncident = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM incidents WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Incident not found',
      });
    }

    res.json({
      success: true,
      message: 'Incident deleted successfully',
      incident: result.rows[0],
    });
  } catch (error) {
    console.error('Delete incident error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to delete incident',
    });
  }
};

// ============================================
// SETTINGS
// ============================================

export const getSettings = async (req, res) => {
  try {
    const result = await query('SELECT * FROM system_settings WHERE id = 1');

    res.json({
      success: true,
      settings: result.rows[0] || {},
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch settings',
    });
  }
};

export const updateSettings = async (req, res) => {
  try {
    const {
      page_title,
      logo_url,
      brand_color,
      custom_message,
      notification_email,
      notifications_enabled,
      data_retention_days,
      webhook_url,
      webhook_enabled,
      google_chat_webhook_url,
      google_chat_webhook_enabled,
      admin_timezone,
    } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (page_title !== undefined) {
      updates.push(`page_title = $${paramCount}`);
      values.push(page_title);
      paramCount++;
    }

    if (logo_url !== undefined) {
      updates.push(`logo_url = $${paramCount}`);
      values.push(logo_url);
      paramCount++;
    }

    if (brand_color !== undefined) {
      updates.push(`brand_color = $${paramCount}`);
      values.push(brand_color);
      paramCount++;
    }

    if (custom_message !== undefined) {
      updates.push(`custom_message = $${paramCount}`);
      values.push(custom_message);
      paramCount++;
    }

    if (notification_email !== undefined) {
      updates.push(`notification_email = $${paramCount}`);
      values.push(notification_email);
      paramCount++;
    }

    if (notifications_enabled !== undefined) {
      updates.push(`notifications_enabled = $${paramCount}`);
      values.push(notifications_enabled);
      paramCount++;
    }

    if (data_retention_days !== undefined) {
      updates.push(`data_retention_days = $${paramCount}`);
      values.push(data_retention_days);
      paramCount++;
    }

    if (webhook_url !== undefined) {
      updates.push(`webhook_url = $${paramCount}`);
      values.push(webhook_url);
      paramCount++;
    }

    if (webhook_enabled !== undefined) {
      updates.push(`webhook_enabled = $${paramCount}`);
      values.push(webhook_enabled);
      paramCount++;
    }

    if (google_chat_webhook_url !== undefined) {
      updates.push(`google_chat_webhook_url = $${paramCount}`);
      values.push(google_chat_webhook_url);
      paramCount++;
    }

    if (google_chat_webhook_enabled !== undefined) {
      updates.push(`google_chat_webhook_enabled = $${paramCount}`);
      values.push(google_chat_webhook_enabled);
      paramCount++;
    }

    if (admin_timezone !== undefined) {
      updates.push(`admin_timezone = $${paramCount}`);
      values.push(admin_timezone);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        error: 'No updates provided',
        message: 'Please provide at least one field to update',
      });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    const updateQuery = `
      UPDATE system_settings
      SET ${updates.join(', ')}
      WHERE id = 1
      RETURNING *
    `;

    const result = await query(updateQuery, values);

    res.json({
      success: true,
      message: 'Settings updated successfully',
      settings: result.rows[0],
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to update settings',
    });
  }
};

// ============================================
// LOGO UPLOAD
// ============================================

export const uploadLogo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
        message: 'Please select a logo file to upload',
      });
    }

    // Construct the URL path for the uploaded file
    const logoUrl = `/uploads/${req.file.filename}`;

    // Update the logo_url in system_settings
    const result = await query(
      `UPDATE system_settings
       SET logo_url = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = 1
       RETURNING *`,
      [logoUrl]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Settings not found',
        message: 'System settings record not found',
      });
    }

    res.json({
      success: true,
      message: 'Logo uploaded successfully',
      logo_url: logoUrl,
      settings: result.rows[0],
    });
  } catch (error) {
    console.error('Upload logo error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to upload logo',
    });
  }
};

// ============================================
// SMTP EMAIL SETTINGS
// ============================================

export const getEmailSettings = async (req, res) => {
  try {
    const result = await query(
      'SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_recipients FROM system_settings WHERE id = 1'
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        emailSettings: {
          smtp_host: '',
          smtp_port: 587,
          smtp_user: '',
          smtp_pass: '',
          smtp_from: '',
          smtp_recipients: '',
        },
      });
    }

    const settings = result.rows[0];

    // Mask the password with placeholder if it exists
    const emailSettings = {
      smtp_host: settings.smtp_host || '',
      smtp_port: settings.smtp_port || 587,
      smtp_user: settings.smtp_user || '',
      smtp_pass: settings.smtp_pass ? '••••••••••••••••' : '',
      smtp_from: settings.smtp_from || '',
      smtp_recipients: settings.smtp_recipients || '',
    };

    res.json({
      success: true,
      emailSettings: emailSettings,
    });
  } catch (error) {
    console.error('Get email settings error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch email settings',
    });
  }
};

export const updateEmailSettings = async (req, res) => {
  try {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_recipients } = req.body;

    // Build the UPDATE query dynamically based on whether password is being updated
    let updateQuery;
    let values;

    if (smtp_pass === '••••••••••••••••') {
      // Don't update password if it's the placeholder
      updateQuery = `
        UPDATE system_settings
        SET smtp_host = $1,
            smtp_port = $2,
            smtp_user = $3,
            smtp_from = $4,
            smtp_recipients = $5,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
        RETURNING *
      `;
      values = [smtp_host, smtp_port, smtp_user, smtp_from, smtp_recipients];
    } else {
      // Update all fields including password
      updateQuery = `
        UPDATE system_settings
        SET smtp_host = $1,
            smtp_port = $2,
            smtp_user = $3,
            smtp_pass = $4,
            smtp_from = $5,
            smtp_recipients = $6,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
        RETURNING *
      `;
      values = [smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_recipients];
    }

    await query(updateQuery, values);

    res.json({
      success: true,
      message: 'Email settings updated successfully. Changes will take effect immediately.',
    });
  } catch (error) {
    console.error('Update email settings error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to update email settings',
    });
  }
};

export const testEmailSettings = async (req, res) => {
  try {
    const { sendEmail } = await import('../services/emailService.js');

    // Get recipient emails from database
    const settingsResult = await query(
      'SELECT smtp_recipients FROM system_settings WHERE id = 1'
    );

    if (!settingsResult.rows.length || !settingsResult.rows[0].smtp_recipients) {
      return res.status(400).json({
        success: false,
        message: 'No recipient emails configured. Please add at least one recipient email address.',
      });
    }

    const recipientEmails = settingsResult.rows[0].smtp_recipients;

    // Send test email to all configured recipients
    const result = await sendEmail({
      to: recipientEmails,
      subject: 'Test Email - Status Monitor',
      text: `This is a test email from Status Monitor.

Your SMTP email configuration is working correctly!

If you received this email, it means:
✓ SMTP host and port are configured correctly
✓ Authentication credentials are valid
✓ Email delivery is functioning properly

Sent at: ${new Date().toISOString()}

---
Status Monitor
`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
          <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <h2 style="color: #3b82f6; margin-top: 0;">✉️ Test Email - Status Monitor</h2>
            <p style="color: #374151; line-height: 1.6;">This is a test email from Status Monitor.</p>
            <p style="color: #374151; line-height: 1.6;"><strong>Your SMTP email configuration is working correctly!</strong></p>

            <div style="background-color: #dbeafe; padding: 15px; border-radius: 6px; margin: 20px 0;">
              <p style="margin: 5px 0; color: #1e40af;">✓ SMTP host and port are configured correctly</p>
              <p style="margin: 5px 0; color: #1e40af;">✓ Authentication credentials are valid</p>
              <p style="margin: 5px 0; color: #1e40af;">✓ Email delivery is functioning properly</p>
            </div>

            <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">Sent at: ${new Date().toISOString()}</p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            <p style="color: #9ca3af; font-size: 12px; text-align: center;">Status Monitor</p>
          </div>
        </div>
      `,
    });

    if (result.success) {
      // Count number of recipients
      const recipientCount = recipientEmails.split(',').map(e => e.trim()).filter(e => e).length;
      const recipientText = recipientCount === 1 ? 'recipient' : `${recipientCount} recipients`;

      res.json({
        success: true,
        message: `Test email sent successfully to ${recipientText}`,
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Email sending failed',
        message: result.error || 'Failed to send test email. Please check your SMTP configuration.',
      });
    }
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message || 'Failed to send test email. Please check your SMTP configuration and make sure the backend has been restarted after updating email settings.',
    });
  }
};

// ============================================
// WEBHOOKS
// ============================================

export const testWebhook = async (req, res) => {
  try {
    // Get webhook settings from database
    const settingsResult = await query(
      'SELECT webhook_url, webhook_enabled FROM system_settings WHERE id = 1'
    );

    if (settingsResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Webhook settings not found',
      });
    }

    const settings = settingsResult.rows[0];

    if (!settings.webhook_url) {
      return res.status(400).json({
        success: false,
        message: 'Webhook URL is not configured',
      });
    }

    // Create test payload (matches real webhook structure - simulates an api_up event with resolution)
    const now = new Date();
    const incidentStart = new Date(now.getTime() - 5 * 60000); // 5 minutes ago
    const testPayload = {
      event_type: 'test',
      status: 'test',
      timestamp: now.toISOString(),
      api: {
        id: 0,
        name: 'Test API',
        url: 'https://example.com/test',
        monitoring_interval: 60,
        expected_status_code: 200,
      },
      incident: {
        id: 0,
        title: 'Test Webhook',
        description: 'This is a test webhook from Status Monitor to verify your endpoint is working correctly',
        status: 'test',
        started_at: incidentStart.toISOString(),
        resolved_at: now.toISOString(),
        downtime_minutes: 5,
      },
    };

    // Send webhook
    const startTime = Date.now();
    try {
      const response = await fetch(settings.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Status-Monitor-Webhook/1.0',
        },
        body: JSON.stringify(testPayload),
      });

      const responseTime = Date.now() - startTime;
      const statusCode = response.status;
      const success = statusCode >= 200 && statusCode < 300;

      if (success) {
        res.json({
          success: true,
          message: `Test webhook sent successfully to ${settings.webhook_url}`,
          details: {
            status_code: statusCode,
            response_time_ms: responseTime,
          },
        });
      } else {
        res.status(500).json({
          success: false,
          message: `Webhook endpoint returned status ${statusCode}`,
          details: {
            status_code: statusCode,
            response_time_ms: responseTime,
          },
        });
      }
    } catch (webhookError) {
      res.status(500).json({
        success: false,
        message: `Failed to send webhook: ${webhookError.message}`,
        error: webhookError.message,
      });
    }
  } catch (error) {
    console.error('Test webhook error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message || 'Failed to send test webhook',
    });
  }
};

export const getWebhookLogs = async (req, res) => {
  try {
    const { limit = 50, offset = 0, apiId } = req.query;

    let queryText = 'SELECT * FROM webhook_logs';
    const values = [];
    let paramCount = 1;

    if (apiId) {
      queryText += ` WHERE api_id = $${paramCount}`;
      values.push(apiId);
      paramCount++;
    }

    queryText += ' ORDER BY created_at DESC';
    queryText += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    values.push(limit, offset);

    const result = await query(queryText, values);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM webhook_logs';
    const countValues = [];
    if (apiId) {
      countQuery += ' WHERE api_id = $1';
      countValues.push(apiId);
    }
    const countResult = await query(countQuery, countValues);

    res.json({
      success: true,
      total: parseInt(countResult.rows[0].total),
      logs: result.rows,
    });
  } catch (error) {
    console.error('Get webhook logs error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch webhook logs',
    });
  }
};

export const testWebhookEndpoint = async (req, res) => {
  try {
    const result = await testWebhookService();

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        statusCode: result.statusCode,
        responseTime: result.responseTime,
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message,
        error: result.error,
        statusCode: result.statusCode,
        responseTime: result.responseTime,
      });
    }
  } catch (error) {
    console.error('Test webhook error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to test webhook',
    });
  }
};

// ============================================
// GOOGLE CHAT WEBHOOK
// ============================================

export const testGoogleChat = async (req, res) => {
  try {
    const { testGoogleChatWebhook } = await import('../services/googleChatService.js');
    const result = await testGoogleChatWebhook();

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        statusCode: result.statusCode,
        responseTime: result.responseTime,
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message,
        error: result.error,
        statusCode: result.statusCode,
        responseTime: result.responseTime,
      });
    }
  } catch (error) {
    console.error('Test Google Chat webhook error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to test Google Chat webhook',
    });
  }
};

// ============================================
// API REORDERING
// ============================================

export const reorderAPIs = async (req, res) => {
  try {
    const { apiIds } = req.body; // Array of API IDs in the desired order

    if (!Array.isArray(apiIds) || apiIds.length === 0) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'apiIds must be a non-empty array',
      });
    }

    // Update display_order for each API
    const updatePromises = apiIds.map((apiId, index) => {
      return query(
        'UPDATE apis SET display_order = $1 WHERE id = $2',
        [index + 1, apiId]
      );
    });

    await Promise.all(updatePromises);

    res.json({
      success: true,
      message: 'API order updated successfully',
    });
  } catch (error) {
    console.error('Reorder APIs error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to update API order',
    });
  }
};

// ============================================
// API GROUPS MANAGEMENT
// ============================================

// Get all API groups with API counts
export const getAPIGroups = async (req, res) => {
  try {
    const result = await query(
      `SELECT g.*,
        COUNT(a.id) as api_count
       FROM api_groups g
       LEFT JOIN apis a ON a.group_id = g.id
       GROUP BY g.id
       ORDER BY g.display_order ASC, g.id ASC`
    );

    res.json({
      success: true,
      groups: result.rows,
    });
  } catch (error) {
    console.error('Get API groups error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch API groups',
    });
  }
};

// Get single API group with its APIs
export const getAPIGroup = async (req, res) => {
  try {
    const { id } = req.params;

    // Get group details
    const groupResult = await query(
      'SELECT * FROM api_groups WHERE id = $1',
      [id]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'API group not found',
      });
    }

    // Get APIs in this group
    const apisResult = await query(
      'SELECT * FROM apis WHERE group_id = $1 ORDER BY display_order ASC, id ASC',
      [id]
    );

    res.json({
      success: true,
      group: {
        ...groupResult.rows[0],
        apis: apisResult.rows,
      },
    });
  } catch (error) {
    console.error('Get API group error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch API group',
    });
  }
};

// Create new API group
export const createAPIGroup = async (req, res) => {
  try {
    const { name, description } = req.body;

    // Validate required fields
    if (!name || name.trim() === '') {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Group name is required',
      });
    }

    // Check for duplicate name
    const existingGroup = await query(
      'SELECT id FROM api_groups WHERE name = $1',
      [name.trim()]
    );

    if (existingGroup.rows.length > 0) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'A group with this name already exists',
      });
    }

    // Get the highest display_order to place new group at the end (excluding default group)
    const maxOrderResult = await query(
      'SELECT MAX(display_order) as max_order FROM api_groups WHERE is_default = FALSE OR is_default IS NULL'
    );
    const nextOrder = (maxOrderResult.rows[0].max_order || 0) + 1;

    // Insert new group
    const result = await query(
      `INSERT INTO api_groups (name, description, display_order, created_at, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [name.trim(), description || null, nextOrder]
    );

    res.status(201).json({
      success: true,
      message: 'API group created successfully',
      group: result.rows[0],
    });
  } catch (error) {
    console.error('Create API group error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to create API group',
    });
  }
};

// Update API group
export const updateAPIGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    // Check if group exists
    const groupCheck = await query(
      'SELECT name, is_default FROM api_groups WHERE id = $1',
      [id]
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'API group not found',
      });
    }

    // Note: Renaming is now allowed for all groups, including the default group

    // Validate required fields
    if (!name || name.trim() === '') {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Group name is required',
      });
    }

    // Check for duplicate name (excluding current group)
    const existingGroup = await query(
      'SELECT id FROM api_groups WHERE name = $1 AND id != $2',
      [name.trim(), id]
    );

    if (existingGroup.rows.length > 0) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'A group with this name already exists',
      });
    }

    // Update group
    const result = await query(
      `UPDATE api_groups
       SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [name.trim(), description || null, id]
    );

    res.json({
      success: true,
      message: 'API group updated successfully',
      group: result.rows[0],
    });
  } catch (error) {
    console.error('Update API group error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to update API group',
    });
  }
};

// Delete API group
export const deleteAPIGroup = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if group exists
    const groupCheck = await query(
      'SELECT name, is_default FROM api_groups WHERE id = $1',
      [id]
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'API group not found',
      });
    }

    // Prevent deleting the default group
    if (groupCheck.rows[0].is_default === true) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Cannot delete the default group',
      });
    }

    // Get the default group ID and name to move orphaned APIs
    const defaultGroupResult = await query(
      'SELECT id, name FROM api_groups WHERE is_default = TRUE LIMIT 1'
    );

    if (defaultGroupResult.rows.length === 0) {
      return res.status(500).json({
        error: 'Server error',
        message: 'Default group not found. Please run database migrations.',
      });
    }

    const defaultGroupId = defaultGroupResult.rows[0].id;
    const defaultGroupName = defaultGroupResult.rows[0].name;

    // Move all APIs from this group to default group
    await query(
      'UPDATE apis SET group_id = $1 WHERE group_id = $2',
      [defaultGroupId, id]
    );

    // Delete the group
    await query('DELETE FROM api_groups WHERE id = $1', [id]);

    res.json({
      success: true,
      message: `API group deleted successfully. APIs moved to ${defaultGroupName}.`,
    });
  } catch (error) {
    console.error('Delete API group error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to delete API group',
    });
  }
};

// Reorder API groups
export const reorderAPIGroups = async (req, res) => {
  try {
    const { groupIds } = req.body;

    if (!Array.isArray(groupIds) || groupIds.length === 0) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'groupIds must be a non-empty array',
      });
    }

    // Update display_order for each group
    const updatePromises = groupIds.map((groupId, index) => {
      return query(
        'UPDATE api_groups SET display_order = $1 WHERE id = $2',
        [index + 1, groupId]
      );
    });

    await Promise.all(updatePromises);

    res.json({
      success: true,
      message: 'API group order updated successfully',
    });
  } catch (error) {
    console.error('Reorder API groups error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to update API group order',
    });
  }
};

// ============================================
// VERSION
// ============================================

// Get application version
export const getVersion = async (req, res) => {
  try {
    const packageJsonPath = join(__dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

    res.json({
      success: true,
      version: packageJson.version,
      name: packageJson.name,
    });
  } catch (error) {
    console.error('Get version error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch version',
    });
  }
};
