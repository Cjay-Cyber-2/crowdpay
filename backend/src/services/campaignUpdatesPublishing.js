const db = require('../config/database');
const logger = require('../config/logger');
const { sendCampaignUpdatePostedEmail } = require('./emailService');
const { createNotification } = require('./notifications');
const { notifyFollowers } = require('./campaignFollowService');

function frontendBaseUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

const UPDATE_EXCERPT_LENGTH = 200;

/**
 * The single public/notification representation of a campaign update. Both the
 * publication/notification path and the creator preview endpoint use this so a
 * preview cannot diverge from what is actually published (#945).
 */
function renderUpdate({ campaignId, campaignTitle, update = {} }) {
  const body = String(update.body || '');
  const excerpt =
    body.length > UPDATE_EXCERPT_LENGTH
      ? `${body.slice(0, UPDATE_EXCERPT_LENGTH).trim()}…`
      : body;

  const attachments = Array.isArray(update.attachments) ? update.attachments : [];

  const isPublished = update.status === 'published' || update.status === undefined || update.status === null;

  return {
    id: update.id || null,
    campaign_id: campaignId,
    title: update.title || '',
    body,
    attachments,
    status: update.status || 'published',
    scheduled_for: update.scheduled_for || null,
    published_at: isPublished ? update.updated_at || update.created_at || null : null,
    link: `${frontendBaseUrl()}/campaigns/${campaignId}`,
    excerpt,
    notification_title: `${campaignTitle}: ${update.title || ''}`,
  };
}

/**
 * Dispatches notifications and emails to campaign followers and contributors.
 *
 * @param {Object} params
 * @param {string} params.campaignId
 * @param {string} params.campaignTitle
 * @param {Object} params.update
 * @param {string} params.authorId
 */
async function sendCampaignUpdateNotifications({ campaignId, campaignTitle, update, authorId }) {
  const rendered = renderUpdate({ campaignId, campaignTitle, update });
  const campaignUrl = rendered.link;
  const updateExcerpt = rendered.excerpt;

  try {
    const { rows: contributors } = await db.query(
      `SELECT DISTINCT ON (u.id) u.id, u.email, u.name
       FROM contributions c
       JOIN users u ON u.wallet_public_key = c.sender_public_key
       WHERE c.campaign_id = $1 AND u.email IS NOT NULL
       ORDER BY u.id, c.created_at ASC`,
      [campaignId]
    );

    await notifyFollowers(
      campaignId,
      'notify_updates',
      {
        type: 'campaign_update',
        title: `${campaignTitle}: ${update.title}`,
        body: updateExcerpt,
        link: `/campaigns/${campaignId}`,
      },
      [authorId, ...contributors.map(c => c.id)]
    ).catch(err => {
      logger.error('Failed to notify campaign followers of update', {
        campaignId,
        updateId: update.id,
        error: err.message,
      });
    });

    await Promise.allSettled(
      contributors.map(async contributor => {
        await createNotification(contributor.id, {
          type: 'campaign_update',
          title: `${campaignTitle}: ${update.title}`,
          body: updateExcerpt,
          link: `/campaigns/${campaignId}`,
        }).catch(() => {});

        return sendCampaignUpdatePostedEmail({
          to: contributor.email,
          updateId: update.id,
          campaignId,
          name: contributor.name,
          campaignTitle,
          campaignUrl,
          updateTitle: update.title,
          updateExcerpt,
          updateBody: update.body,
        }).catch(err => {
          logger.error('Failed to send campaign update email', {
            contributorId: contributor.id,
            updateId: update.id,
            error: err.message,
          });
        });
      })
    );
  } catch (err) {
    logger.error('Error in sendCampaignUpdateNotifications', {
      campaignId,
      updateId: update?.id,
      error: err.message,
    });
  }
}

/**
 * Finds scheduled campaign updates whose scheduled_for time has arrived,
 * marks them 'published' idempotently, and notifies followers and contributors.
 *
 * @returns {Promise<Array<Object>>} List of published updates
 */
async function publishDueCampaignUpdates() {
  const { rows: dueUpdates } = await db.query(
    `SELECT cu.id, cu.campaign_id, cu.author_id, cu.title, cu.body, cu.attachments, cu.scheduled_for,
            c.title AS campaign_title
     FROM campaign_updates cu
     JOIN campaigns c ON c.id = cu.campaign_id
     WHERE cu.status = 'scheduled' AND cu.scheduled_for <= NOW()
     ORDER BY cu.scheduled_for ASC
     LIMIT 50`
  );

  if (!dueUpdates.length) {
    return [];
  }

  const published = [];

  for (const update of dueUpdates) {
    try {
      const { rows: updated } = await db.query(
        `UPDATE campaign_updates
         SET status = 'published', updated_at = NOW()
         WHERE id = $1 AND status = 'scheduled'
         RETURNING id, campaign_id, author_id, title, body, attachments, status, scheduled_for, created_at, updated_at`,
        [update.id]
      );

      if (!updated.length) {
        // Already published by concurrent runner
        continue;
      }

      const publishedUpdate = updated[0];
      published.push(publishedUpdate);

      // Trigger notifications at publish time
      sendCampaignUpdateNotifications({
        campaignId: update.campaign_id,
        campaignTitle: update.campaign_title,
        update: publishedUpdate,
        authorId: update.author_id,
      }).catch(err => {
        logger.error('Failed to dispatch notifications for published update', {
          updateId: update.id,
          error: err.message,
        });
      });
    } catch (err) {
      logger.error('Failed to publish scheduled update', {
        updateId: update.id,
        error: err.message,
      });
    }
  }

  return published;
}

module.exports = {
  renderUpdate,
  sendCampaignUpdateNotifications,
  publishDueCampaignUpdates,
};
