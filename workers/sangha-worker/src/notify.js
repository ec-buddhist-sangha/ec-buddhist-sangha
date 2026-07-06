// workers/sangha-worker/src/notify.js
// Emails the bootstrap admins when a NEW member-access request is created, via
// the Cloudflare Email Routing send_email binding. The transport is injectable
// so unit tests never touch the real binding or the cloudflare:email module.
import { createMimeMessage } from "mimetext/browser";
import { getBootstrapAdmins } from "./members.js";

export function buildRequestMime(requester, env, recipient) {
  const msg = createMimeMessage();
  msg.setSender({ name: "Eau Claire Buddhist Sangha", addr: env.NOTIFY_SENDER });
  msg.setRecipient(recipient);
  msg.setSubject("New member access request");
  msg.addMessage({
    contentType: "text/plain",
    data:
      `${requester.name} <${requester.email}> requested member access.\n\n` +
      `Review pending requests: ${env.CORS_ORIGIN}/account/members`
  });
  return msg;
}

async function defaultTransport(env, from, to, raw) {
  const { EmailMessage } = await import("cloudflare:email");
  await env.SEND_EMAIL.send(new EmailMessage(from, to, raw));
}

export async function notifyAdminsOfRequest(env, requester, options = {}) {
  const recipients = [...getBootstrapAdmins(env)];
  if (recipients.length === 0) return { sent: 0 };
  const transport = options.transport || defaultTransport;
  // Attempt all recipients even if some throw (e.g. an unverified Email
  // Routing destination address), so one bad address can't suppress
  // notifications to the rest of the admins.
  const results = await Promise.allSettled(
    recipients.map((to) =>
      transport(env, env.NOTIFY_SENDER, to, buildRequestMime(requester, env, to).asRaw())
    )
  );
  const sent = results.filter((result) => result.status === "fulfilled").length;
  return { sent };
}
