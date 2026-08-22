import express from 'express';
import {
  acknowledgeAlarmPage,
  muteAlarmForDevice,
} from '../controllers/publicController.js';

const router = express.Router();

/**
 * Critical alarm responder actions — opened by tapping the phone notification.
 *
 * Intentionally unauthenticated: these have to work from a locked phone at 3am
 * with nobody signed in. Authorisation comes from the single-purpose, 256-bit
 * token minted per incident and compared in constant time.
 *
 * Silencing is per-device only, by design. There is deliberately no action that
 * stops the alarm on everyone's phone: the alarm ends when each person silences
 * their own, when the service recovers (automatic), or when the max-duration
 * window closes.
 *
 * The GET only renders a confirmation; it never silences anything. Link
 * previewers, security scanners and browser prefetch all issue GETs, so the
 * action itself is a POST.
 *
 * Mounted ahead of the shared public rate limiter in server.js so a burst of
 * responder traffic can never exhaust the public status page's budget.
 */
router.get('/:incidentId', acknowledgeAlarmPage);

// "Silence my phone" — mutes this device, leaves everyone else ringing.
router.post('/:incidentId/mute', muteAlarmForDevice);

export default router;
