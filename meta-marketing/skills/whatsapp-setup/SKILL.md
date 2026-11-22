---
name: whatsapp-setup
description: Set up WhatsApp Business messaging on the Cloud API, from checking prerequisites and registering a number to message templates and webhooks. Use for any WhatsApp Business onboarding or template work.
---

# Set up WhatsApp Business messaging

Uses Meta's WhatsApp Business Tools server. It sets up and sends; it never reads a
conversation.

1. Prerequisites, before anything else: `whatsapp_biz_businesses`,
   `whatsapp_biz_accounts`, `whatsapp_biz_phone_numbers`, and
   `whatsapp_biz_verify_business` for verification status. Messaging and number
   registration are blocked until an admin has accepted the Cloud API terms and a
   payment method is set; if either is missing, give the person the link and stop.
2. A number: `whatsapp_biz_add_phone_number`, `whatsapp_biz_send_verification_code`,
   then `whatsapp_biz_verify_phone_number` with the code the person reads out, then
   `whatsapp_biz_register_phone_number`. Each of these changes the business's account
   and is confirmed with the person first.
3. Templates: `whatsapp_biz_list_templates` before creating, so nothing is duplicated.
   `whatsapp_biz_create_template` with the category that matches the use (marketing,
   utility, authentication). Approval is Meta's and takes time: report the status once
   and do not poll.
4. Webhooks: `whatsapp_biz_configure_webhooks` with the app's intake address, then
   `whatsapp_biz_subscribe_webhook`.
5. Sending: `whatsapp_biz_send_message` sends free text only inside the 24 hours after
   the customer last wrote, and an approved template otherwise. Confirm the recipient
   and the text with a person before every send.

A general-purpose assistant may not be offered to the public through the WhatsApp
Business Platform. An agent answering a business's own customers about that business
is what this is for.
