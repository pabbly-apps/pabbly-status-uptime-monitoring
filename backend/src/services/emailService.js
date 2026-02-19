import { createTransport } from 'nodemailer';
import { query } from '../config/database.js';
import { formatWithTimezone, getAdminTimezone } from '../utils/timezone.js';

/**
 * Get SMTP settings from database
 */
async function getSMTPSettings() {
  try {
    const result = await query(
      'SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from FROM system_settings WHERE id = 1'
    );

    if (result.rows.length === 0) {
      return null;
    }

    const settings = result.rows[0];

    // Only return settings if host and user are configured
    if (!settings.smtp_host || !settings.smtp_user) {
      return null;
    }

    return settings;
  } catch (error) {
    console.error('Error fetching SMTP settings from database:', error);
    return null;
  }
}

/**
 * Initialize email transporter with database settings
 */
async function initializeTransporter() {
  try {
    const smtpSettings = await getSMTPSettings();

    if (!smtpSettings) {
      console.log('⚠️  Email notifications disabled (SMTP not configured)');
      return null;
    }

    const transporter = createTransport({
      host: smtpSettings.smtp_host,
      port: parseInt(smtpSettings.smtp_port) || 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: smtpSettings.smtp_user,
        pass: smtpSettings.smtp_pass,
      },
    });

    console.log('✅ Email transporter initialized from database settings');
    return transporter;
  } catch (error) {
    console.error('❌ Error initializing email transporter:', error);
    return null;
  }
}

/**
 * Check if email notifications are enabled (based on SMTP configuration)
 */
async function areNotificationsEnabled() {
  try {
    const result = await query(
      'SELECT smtp_host, smtp_port, smtp_user, smtp_recipients, notification_email FROM system_settings WHERE id = 1'
    );

    if (result.rows.length === 0) {
      return { enabled: false, emails: [] };
    }

    const settings = result.rows[0];

    // Check if SMTP is configured (host, port, user must be present)
    const smtpConfigured = settings.smtp_host && settings.smtp_port && settings.smtp_user;

    if (!smtpConfigured) {
      return { enabled: false, emails: [] };
    }

    // Get recipient emails
    let recipientEmails = [];
    if (settings.smtp_recipients && settings.smtp_recipients.trim()) {
      // Split by comma and trim whitespace
      recipientEmails = settings.smtp_recipients.split(',').map(email => email.trim()).filter(email => email);
    } else if (settings.notification_email && settings.notification_email.trim()) {
      // Fallback to old notification_email field
      recipientEmails = [settings.notification_email.trim()];
    }

    // Enabled only if SMTP is configured AND there are recipients
    return {
      enabled: recipientEmails.length > 0,
      emails: recipientEmails,
    };
  } catch (error) {
    console.error('Error checking notification settings:', error);
    return { enabled: false, emails: [] };
  }
}

/**
 * Send downtime alert email
 */
export async function sendDowntimeAlert(api, incident) {
  try {
    // Check if notifications are enabled
    const notificationSettings = await areNotificationsEnabled();

    if (!notificationSettings.enabled) {
      return;
    }

    // Initialize transporter with database settings
    const emailTransporter = await initializeTransporter();

    if (!emailTransporter) {
      return;
    }

    // Get SMTP settings for 'from' address
    const smtpSettings = await getSMTPSettings();

    const recipientEmails = notificationSettings.emails.join(', ');
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const timezone = await getAdminTimezone();
    const startedAt = formatWithTimezone(new Date(incident.started_at), timezone);

    // Build status code info
    const statusCode = incident.status_code;
    const statusCodeText = statusCode
      ? `${statusCode}`
      : 'N/A (Connection failed or timeout)';
    const errorMessage = statusCode
      ? `Unexpected status code: ${statusCode} (expected ${api.expected_status_code})`
      : 'Connection failed or request timed out';

    // Email content
    const subject = `🔴 ALERT: ${api.name} is Down`;
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; margin: 0; padding: 0; background-color: #f3f4f6;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 20px 0;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                  <!-- Header -->
                  <tr>
                    <td style="background-color: #fee2e2; border-bottom: 3px solid #dc2626; padding: 16px; text-align: center;">
                      <h1 style="margin: 0; font-size: 18px; font-weight: 600; color: #dc2626;">🔴 API DOWNTIME ALERT</h1>
                    </td>
                  </tr>
                  <!-- Content -->
                  <tr>
                    <td style="padding: 24px;">
                      <!-- Incident Info -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                        <tr>
                          <td width="120" style="padding: 8px 0; font-weight: 500; color: #6b7280; vertical-align: top;">Service:</td>
                          <td style="padding: 8px 0; color: #1f2937;"><strong>${api.name}</strong></td>
                        </tr>
                        <tr>
                          <td width="120" style="padding: 8px 0; font-weight: 500; color: #6b7280; vertical-align: top;">Status:</td>
                          <td style="padding: 8px 0;">
                            <span style="display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; background-color: #fef2f2; color: #dc2626;">Ongoing</span>
                          </td>
                        </tr>
                        <tr>
                          <td width="120" style="padding: 8px 0; font-weight: 500; color: #6b7280; vertical-align: top;">Incident ID:</td>
                          <td style="padding: 8px 0; color: #1f2937;">#${incident.id}</td>
                        </tr>
                        <tr>
                          <td width="120" style="padding: 8px 0; font-weight: 500; color: #6b7280; vertical-align: top;">Started:</td>
                          <td style="padding: 8px 0; color: #1f2937;">${startedAt}</td>
                        </tr>
                      </table>

                      <!-- Divider -->
                      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;">

                      <!-- Endpoint Details -->
                      <div style="font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px;">Endpoint Details</div>
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 16px;">
                        <tr>
                          <td width="120" style="padding: 8px 0; font-weight: 500; color: #6b7280; vertical-align: top;">URL:</td>
                          <td style="padding: 8px 0; color: #1f2937; word-break: break-all;">${api.url}</td>
                        </tr>
                        <tr>
                          <td width="120" style="padding: 8px 0; font-weight: 500; color: #6b7280; vertical-align: top;">Status Code:</td>
                          <td style="padding: 8px 0; color: #1f2937;"><strong>${statusCodeText}</strong></td>
                        </tr>
                        <tr>
                          <td width="120" style="padding: 8px 0; font-weight: 500; color: #6b7280; vertical-align: top;">Error:</td>
                          <td style="padding: 8px 0; color: #1f2937;">${errorMessage}</td>
                        </tr>
                      </table>

                      <!-- Action Box -->
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 16px;">
                            <strong style="color: #dc2626;">ACTION REQUIRED:</strong><br>
                            Investigate the issue immediately. Check server logs, upstream services, and infrastructure status.
                          </td>
                        </tr>
                      </table>

                      <!-- Button -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 24px;">
                        <tr>
                          <td align="center">
                            <a href="${frontendUrl}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">View Status Page</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <!-- Footer -->
                  <tr>
                    <td style="text-align: center; padding: 16px; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb;">
                      This is an automated alert from Status Monitor
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;

    const textContent = `[ALERT] ${api.name} Down - Incident #${incident.id}

---

🔴 API DOWNTIME ALERT

Service: ${api.name}
Status: Ongoing
Incident ID: #${incident.id}
Started: ${startedAt}

---

ENDPOINT DETAILS:
URL: ${api.url}
Status Code: ${statusCodeText}
Error: ${errorMessage}

ACTION REQUIRED:
Investigate the issue immediately. Check server logs, upstream services, and infrastructure status.

View Details: ${frontendUrl}

---
This is an automated alert from Status Monitor
    `;

    // Send email
    const mailOptions = {
      from: smtpSettings.smtp_from || `"Status Monitor" <${smtpSettings.smtp_user}>`,
      bcc: recipientEmails,
      subject: subject,
      text: textContent,
      html: htmlContent,
    };

    await emailTransporter.sendMail(mailOptions);
  } catch (error) {
    console.error('Error sending downtime alert email:', error);
  }
}

/**
 * Send recovery notification email
 * @param {object} api - API object with id, name, url, etc.
 * @param {object} incident - Incident object with details
 * @param {number} downtimeMinutes - Duration of the downtime in minutes
 * @param {number|null} currentStatusCode - Current HTTP status code (recovery code, e.g., 200)
 */
export async function sendRecoveryNotification(api, incident, downtimeMinutes, currentStatusCode = null) {
  try {
    const notificationSettings = await areNotificationsEnabled();

    if (!notificationSettings.enabled) {
      return;
    }

    const emailTransporter = await initializeTransporter();

    if (!emailTransporter) {
      return;
    }

    // Get SMTP settings for 'from' address
    const smtpSettings = await getSMTPSettings();

    const recipientEmails = notificationSettings.emails.join(', ');
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const timezone = await getAdminTimezone();
    const startedAt = formatWithTimezone(new Date(incident.started_at), timezone);
    const resolvedAt = formatWithTimezone(new Date(incident.resolved_at || Date.now()), timezone);

    // Build status code info
    const originalStatusCode = incident.status_code;
    const recoveryStatusCode = currentStatusCode || api.expected_status_code;

    const subject = `🟢 RESOLVED: ${api.name} is Back Online`;
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; margin: 0; padding: 0; background-color: #f3f4f6;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 20px 0;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                  <!-- Header -->
                  <tr>
                    <td style="background-color: #a7f3d0; border-bottom: 3px solid #059669; padding: 16px; text-align: center;">
                      <h1 style="margin: 0; font-size: 18px; font-weight: 600; color: #047857;">🟢 SERVICE RECOVERED</h1>
                    </td>
                  </tr>
                  <!-- Content -->
                  <tr>
                    <td style="padding: 24px;">
                      <!-- Incident Info -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                        <tr>
                          <td width="110" style="padding: 6px 0; font-weight: 500; color: #6b7280; vertical-align: top;">Service:</td>
                          <td style="padding: 6px 0; color: #1f2937;"><strong>${api.name}</strong></td>
                        </tr>
                        <tr>
                          <td width="110" style="padding: 6px 0; font-weight: 500; color: #6b7280; vertical-align: top;">Incident ID:</td>
                          <td style="padding: 6px 0; color: #1f2937;">#${incident.id}</td>
                        </tr>
                        <tr>
                          <td width="110" style="padding: 6px 0; font-weight: 500; color: #6b7280; vertical-align: top;">Started:</td>
                          <td style="padding: 6px 0; color: #1f2937;">${startedAt}</td>
                        </tr>
                        <tr>
                          <td width="110" style="padding: 6px 0; font-weight: 500; color: #6b7280; vertical-align: top;">Resolved:</td>
                          <td style="padding: 6px 0; color: #1f2937;">${resolvedAt}</td>
                        </tr>
                        <tr>
                          <td width="110" style="padding: 6px 0; font-weight: 500; color: #6b7280; vertical-align: top;">Downtime:</td>
                          <td style="padding: 6px 0;">
                            <span style="display: inline-block; background-color: #fef3c7; padding: 4px 10px; border-radius: 4px; color: #92400e; font-weight: 600;">${downtimeMinutes} minute(s)</span>
                          </td>
                        </tr>
                      </table>

                      <!-- Divider -->
                      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;">

                      <!-- Endpoint Details -->
                      <div style="font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">Endpoint Details</div>
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                        <tr>
                          <td width="110" style="padding: 6px 0; font-weight: 500; color: #6b7280; vertical-align: top;">URL:</td>
                          <td style="padding: 6px 0; color: #1f2937; word-break: break-all;">${api.url}</td>
                        </tr>
                        <tr>
                          <td width="110" style="padding: 6px 0; font-weight: 500; color: #6b7280; vertical-align: top;">Original Error:</td>
                          <td style="padding: 6px 0; color: #1f2937;">${originalStatusCode ? `HTTP ${originalStatusCode}` : 'Connection failed'}</td>
                        </tr>
                        <tr>
                          <td width="110" style="padding: 6px 0; font-weight: 500; color: #6b7280; vertical-align: top;">Current Status:</td>
                          <td style="padding: 6px 0; color: #1f2937;"><strong>HTTP ${recoveryStatusCode}</strong> (Healthy)</td>
                        </tr>
                      </table>

                      <!-- Button -->
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td align="center">
                            <a href="${frontendUrl}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">View Status Page</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <!-- Footer -->
                  <tr>
                    <td style="text-align: center; padding: 16px; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb;">
                      This is an automated notification from Status Monitor
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;

    const textContent = `[RESOLVED] ${api.name} Back Online - Incident #${incident.id}

---

🟢 SERVICE RECOVERED

Service: ${api.name}
Status: Resolved
Incident ID: #${incident.id}
Started: ${startedAt}
Resolved: ${resolvedAt}
Total Downtime: ${downtimeMinutes} minute(s)

---

ENDPOINT DETAILS:
URL: ${api.url}
Original Error: ${originalStatusCode ? `HTTP ${originalStatusCode}` : 'Connection failed'}
Current Status: HTTP ${recoveryStatusCode} (Healthy)

ALL SYSTEMS OPERATIONAL
The service is now responding normally. The incident has been automatically resolved.

View Details: ${frontendUrl}

---
This is an automated notification from Status Monitor
    `;

    const mailOptions = {
      from: smtpSettings.smtp_from || `"Status Monitor" <${smtpSettings.smtp_user}>`,
      bcc: recipientEmails,
      subject: subject,
      text: textContent,
      html: htmlContent,
    };

    await emailTransporter.sendMail(mailOptions);
  } catch (error) {
    console.error('Error sending recovery notification:', error);
  }
}

/**
 * Send a generic email
 */
export async function sendEmail({ to, subject, text, html }) {
  try {
    const emailTransporter = await initializeTransporter();

    if (!emailTransporter) {
      return {
        success: false,
        error: 'Email transporter not configured. Please check your SMTP settings in the Admin Settings.',
      };
    }

    // Get SMTP settings for 'from' address
    const smtpSettings = await getSMTPSettings();

    // Verify SMTP connection first
    try {
      await emailTransporter.verify();
    } catch (verifyError) {
      return {
        success: false,
        error: `SMTP connection failed: ${verifyError.message}`,
      };
    }

    // Send email
    const mailOptions = {
      from: smtpSettings.smtp_from || `"Status Monitor" <${smtpSettings.smtp_user}>`,
      bcc: to,
      subject: subject,
      text: text,
      html: html,
    };

    await emailTransporter.sendMail(mailOptions);

    return {
      success: true,
      message: `Email sent successfully to ${to}`,
    };
  } catch (error) {
    console.error('Error sending email:', error);
    return {
      success: false,
      error: error.message || 'Failed to send email',
    };
  }
}

/**
 * Test email configuration
 */
export async function testEmailConfiguration() {
  try {
    const emailTransporter = await initializeTransporter();

    if (!emailTransporter) {
      return {
        success: false,
        message: 'Email transporter not configured',
      };
    }

    const notificationSettings = await areNotificationsEnabled();

    if (!notificationSettings.enabled) {
      return {
        success: false,
        message: 'Email notifications are disabled in settings',
      };
    }

    // Verify SMTP connection
    await emailTransporter.verify();

    return {
      success: true,
      message: 'Email configuration is valid',
      recipient: notificationSettings.email,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
    };
  }
}

export default {
  sendEmail,
  sendDowntimeAlert,
  sendRecoveryNotification,
  testEmailConfiguration,
};
