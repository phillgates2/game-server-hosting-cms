/**
 * The shipped Terms of Service and Privacy Policy.
 *
 * These are the text a fresh install publishes before anyone edits anything.
 * They are written to be *true of this software* — the account, forum, shop and
 * licensing features that exist in the panel as it is built — and deliberately
 * plain: short sentences, numbered sections, and no promises the operator has
 * not made (no uptime SLA, no backup guarantee, no claim that a take-down
 * happens "within 24 hours").
 *
 * Two rules keep them honest, and both are enforceable in review:
 *
 *   1. Every factual claim must be traceable to code. "Passwords are stored as
 *      bcrypt hashes" is in here because `src/lib/auth.ts` does exactly that;
 *      an invented data-retention period is not.
 *   2. Anything only the operator can know is a `{{placeholder}}`. The operator
 *      name, contact address and governing law come from settings, so the
 *      documents cannot contradict the rest of the site.
 *
 * Editing them is expected. Clearing a document in the Site Editor restores the
 * text below, which means "undo" always works without a backup.
 */

export const DEFAULT_TERMS_TEXT = `# Terms of Service

**Last updated: {{updated}}** · These terms are between you and {{operator}} ("we", "us"). They cover the {{panel}} website, the control panel behind it, the game servers you run here, the community features (forum and chat) and anything you buy from the store.

By creating an account, signing in, buying something or using the service, you agree to these terms. If you do not agree, do not use the service.

**Before you start: read these with a critical eye.** They were supplied with the software as a starting point and edited by whoever runs this deployment. They are not legal advice. If what you need is certainty — a business contract, a service level, a data processing agreement with a customer — ask us for one in writing.

## 1. Who may use the service

You must be at least 16 years old to hold an account. That floor is set by the Online Safety Amendment (Social Media Minimum Age) Act 2024, because this service includes community features. We record the date of birth you declare at registration and store when the declaration was accepted; if we learn an account belongs to someone under the minimum age, we will close it.

You must give accurate details when you register, and keep the email address on your account current, because that is where order keys, password resets and security notices go. One person, one account: accounts are not shared, sold or transferred without our written agreement.

If you act for a company, you confirm you may bind it to these terms, and "you" means that company.

## 2. Your account and your security

You are responsible for what happens under your account. Keep your password to yourself, turn on two-factor authentication if you have the option, and tell us promptly at {{contact}} if you think someone else has access.

We may suspend or close an account that we reasonably believe is compromised, is being used to attack the service or another network, or is being used to break these terms. Where it is safe and practical to do so, we will tell you why.

## 3. What the service is, and what it is not

The control panel installs, configures, starts, stops, backs up and monitors game servers, and gives you files, consoles, scheduled tasks and a community area around them. It runs on hardware supplied by whoever operates this deployment.

We do not control the games themselves. Game files, mods and server software come from third parties (Steam, the game's publisher, mod authors) and are governed by their own licences and terms. You are responsible for holding the licences you need to run what you run.

**No uptime guarantee.** This is not an enterprise SLA and nothing here promises one. Hosts reboot, game updates break starts, disks fill. We will keep the service working as well as we reasonably can, and the "when something goes wrong" behaviour described in your panel's documentation applies, but we do not promise any particular level of availability. If you need a contracted service level, ask for one before you rely on the service for anything important.

## 4. Acceptable use

Use the service for running game servers and the communities around them. Do not use it to:

- break the law, or help anyone else break it;
- attack, scan, flood or overload any system you do not own — including ours;
- run a server for fraud, phishing, malware, booter or stress-testing services, credential trading or stolen goods;
- infringe copyright, trade marks or other rights: no pirated games, no unlicensed content ripped from someone else's server;
- host or distribute sexual content involving minors, or content that sexualises minors in any way;
- harass, threaten, dox or stalk anyone, or post hateful content in the forum and chat;
- evade a suspension, a ban or a resource limit we have applied;
- resell the service to others except through the reseller programme, if one is enabled;
- use automated scraping of the panel or the API beyond the rate limits we publish.

Breaking this section can end your access immediately. Severe cases — an attack on another network, or content involving minors — can be reported to the relevant authority.

## 5. Your content

You keep ownership of everything you upload: server files, world saves, configs, forum posts, chat messages, images and anything else. You grant us a limited licence to store, copy, transmit and back it up as needed to run the service for you — nothing more, and it ends when the content is deleted or your account is closed.

You are responsible for the content you host. You confirm you have the rights to it, and that running it does not break the law or the game publisher's rules.

**Backups are your responsibility as well as ours.** We offer backup features and *may* keep archives, but a backup only counts if you have checked it. Keep your own copy of anything you cannot afford to lose — a world save, a database dump, a mod pack.

## 6. Community features

The forum and chat are public to other members of this deployment. What you post there is visible to them, and may be visible to the public if the site's owner has enabled public pages.

Moderators may edit, move, lock or delete anything that breaks section 4 or the rules posted in each forum, and may mute an account that keeps breaking them. Moderation is a judgement call; if you think a call was wrong, write to {{contact}} and it will be looked at again, once.

## 7. Orders, payments and delivery

Prices, currencies, taxes and availability are shown at checkout. A checkout is an offer to buy, and the order is accepted when payment clears or, for manually approved orders, when we approve it.

**Delivery** is by email to the address you gave at checkout, and in the panel under Orders. Licences and digital goods are delivered automatically once payment clears. Physical goods are shipped to the address you supply.

**If a payment is reversed** — a chargeback, a disputed card payment, a bounced transfer — the order is cancelled and any licence issued against it is suspended until the amount is paid. We will tell you before we do anything permanent.

Cards are processed by Stripe where card payments are enabled. We never see or store your full card number; Stripe handles that and gives us a reference. Manually approved orders are settled the way the store page says.

## 8. Refunds and cancellations

**Nothing in these terms takes away a right you have under the Australian Consumer Law.** If something you bought is not fit for the purpose you were told it would serve, or is not as described, you may be entitled to a remedy — a repair, a replacement or a refund. Nothing here is meant to limit that, and where these terms and the law disagree, the law wins.

Beyond your statutory rights, our policy is:

- **Digital goods and licence keys are final once the key has been revealed or emailed**, because a key cannot be un-issued. If a key does not work, contact us and we will replace it or refund it — an unusable key is not a sale.
- **Subscriptions** can be cancelled at any time from your panel; access continues to the end of the period you have paid for. We do not pro-rate a period that has already started unless the service was unusable because of something we did.
- **Physical goods** can be returned if unused and in their packaging, under the store's stated return window.
- **Duplicate or mistaken orders**: tell us before a key has been used and we will unwind it.

Ask for a refund at {{contact}} with your order number, and give us the chance to fix the problem first — most complaints are a five-minute fix.

## 9. Licence keys and software licensing

Where a purchase includes a licence key for {{panel}}, the key is bound to the activations shown on the order. Do not share keys, publish them, or work around the activation limit. A revoked key stops working.

The software behind this panel is open source under the MIT licence. These terms govern your use of *this deployment*, not your rights under that licence, which come from the licence itself.

## 10. Our stuff

The panel's software, the site's design and the content we write belong to their respective owners and are protected by copyright. Do not copy the site or resell access to the panel except as the MIT licence and our reseller terms allow.

## 11. Availability, changes and maintenance

We may schedule restarts, apply security updates, migrate a server between machines, or take a host out of service. We try to give notice, and the panel has maintenance windows and a status page for exactly this, but a security patch cannot always wait.

We may change these terms. When we do, the version date at the top of this page changes, and we will post a notice on the site for anything material. If you keep using the service after a change, you accept the new version; if you do not accept it, stop using the service and ask us to close your account.

## 12. Ending the arrangement

You can close your account at any time. We will stop charging you from that point.

We may suspend the service, or close an account, if you seriously or repeatedly break these terms, if we are required to by law or by a game publisher, or if we stop operating this deployment entirely. For a plain non-payment or a first small mistake we will ask you to fix it first.

When an account closes, the data behind it is deleted on the schedule described in the Privacy Policy. Export what you need first — deletion is deletion.

## 13. Liability

Nothing in this section limits a right or remedy you have under the Australian Consumer Law, or any other right that cannot lawfully be excluded.

To the extent the law allows it, the service is provided "as is", we exclude the warranties the law lets us exclude, and we are not liable for indirect or consequential loss — lost profits, lost players, lost data, lost goodwill — or for anything a third party (a game publisher, an upstream host, a payment processor, an internet provider) does.

Where our liability cannot be excluded but can be limited, it is limited to resupplying the service, or paying for it to be supplied again, or the amount you paid us in the twelve months before the event that gave rise to the claim. Choose whichever is greater.

## 14. Indemnity

If a claim is brought against us because of something you hosted, uploaded or posted, or because you broke these terms, you agree to cover our reasonable costs of dealing with it. We will tell you promptly, and let you take part in the defence.

## 15. Complaints and disputes

Write to {{contact}} first. Give us the order or account reference and what went wrong; most things are resolved the same week.

If it is not resolved, the next step is to tell us in writing what outcome you want. These terms are governed by the laws of {{jurisdiction}}, and the courts of {{jurisdiction}} have non-exclusive jurisdiction — non-exclusive because you keep any right to bring a claim where you live. Before going to court, both of us agree to try to settle the dispute in good faith.

## 16. General

- These terms, the Privacy Policy and any order you place are the whole agreement between us.
- If one clause is found unenforceable, the rest stays in force.
- If we do not enforce a clause on one occasion, that is not a waiver of it.
- We may transfer our rights and obligations to another operator of this service; we will give notice, and you may close your account if you object.
- Where these terms are translated, the English version prevails.

**Contact:** {{contact}}
`;

export const DEFAULT_PRIVACY_TEXT = `# Privacy Policy

**Last updated: {{updated}}** · {{operator}} runs this deployment of {{panel}}. This policy explains what personal information we collect, why, who we share it with, how long we keep it and how you can get it back or have it deleted.

It is written against what the software actually does — the fields it really stores, the third parties it can really talk to — but the words are ours to change, and this deployment may switch features on or off. Where a feature is disabled, the data it would collect is not collected.

## 1. The short version

We collect what an account needs: a username, an email address, a password hash, and the declarations the law requires. If you buy something, we also have your order details. If you use a game server, we have the files you put on it. We do not sell personal information, we do not run advertising trackers, and the only third parties involved are the ones listed in section 5 — all of which are optional and off unless the operator turns them on.

## 2. What we collect

**When you create an account**

- Username, email address and a password. The password is stored as a bcrypt hash, never in plain text, and cannot be reversed by us.
- Your date of birth, if the age gate is enabled. We use it once, to check you meet the minimum age, and store the date and the time the declaration was accepted so the check can be audited. We do not use it for marketing or profiling.
- The time you registered, the last time you signed in, your last sign-in IP address and how many times you have signed in.

**When you sign in**

- A session identifier, kept in a cookie (see section 6), plus the IP address and browser description attached to that session so you can see and end your active sessions from your profile.
- If you enable two-factor authentication, the shared secret and hashed single-use recovery codes needed to check your codes.

**When you use the panel**

- The servers you create, their configuration, ports, files, world saves and console output. This is *your* content (section 7), and most of it is not personal information about anyone until someone puts it there.
- Player names and player counts sampled from your servers so the panel can draw join/leave history, heatmaps and ladder standings.
- An audit log of actions taken in the panel — who started, stopped, changed or deleted what, and from which address. This exists so a mistake or a misuse can be traced; it is not used for anything else.
- Files you upload through the file manager or the built-in FTP server.

**When you use the community features**

- Forum threads, replies, chat messages, your profile fields (avatar, bio, location, website) and the timestamps attached to all of them. Forum and chat content is visible to other members, and to the public where the operator has enabled a public site.

**When you buy something**

- The email address and optional name supplied at checkout, the products and quantities ordered, the amount, currency and status of the order, coupon and reseller references, and — for physical goods — the shipping address you enter.
- A payment reference from the payment processor. We do not receive or store your card number, its security code or your full billing address; those stay with the processor.
- The licence key issued to you, and its activations, so support can see why a key is or is not working.

**Technical data**

- Server logs record requests (address, path, response code, timing) so faults and abuse can be diagnosed, and rate limits are enforced.
- The panel does not use third-party analytics, advertising pixels or social login buttons that load scripts from elsewhere.

## 3. Why we handle it

We use personal information to:

- run your account and the servers on it, and let you sign in;
- deliver what you bought, and support you when it does not work;
- keep the service secure: rate limiting, abuse detection, audit trails, session revocation;
- comply with the law, including the minimum-age requirement and tax and accounting obligations;
- answer your questions and complaints.

We do not use your information for automated decision-making that has a legal or similarly significant effect on you, and we do not profile you for advertising.

## 4. Children

Accounts are for people aged 16 and over. If the age gate is enabled, registration is refused for anyone younger, and we store the declared date of birth as evidence that the check was made. If you believe a child under the minimum age holds an account here, write to {{contact}} and it will be investigated and closed.

## 5. Who we share it with

We do not sell personal information, and we do not share it for anyone else's marketing.

Third parties are involved only where the operator has configured them, and each one gets only what the feature needs:

- **Email delivery.** Account emails — welcome, password reset, order receipts, crash alerts — are sent through the mail server the operator configures. That server necessarily sees the recipient address and the message.
- **Stripe**, if card payments are enabled. Stripe receives the order amount, currency, product description and your email address in order to take the payment; the card details are entered on Stripe's own checkout page. Stripe's own privacy policy governs what it does with them.
- **Discord**, if the operator has connected a Discord bot or webhooks. Notifications about your servers (started, stopped, crashed, players joining) can be posted to channels the operator controls, and if you sign in with Discord, Discord passes us your Discord identifier and email. Only enable Discord features if you are content with that.
- **Node machines.** If this deployment runs servers across several machines, the panel sends the files, configuration and console commands for a server to the machine that runs it. Those machines are the operator's own infrastructure, not a third party in the ordinary sense, but they are separate computers holding copies of your data.
- **Outbound webhooks**, if the operator has set one up: events (server status changes, alerts) are posted to a URL the operator chooses. Anything that URL's owner does with the payload is outside our control.
- **Authorities.** We may disclose information where we are required to by law, or where disclosure is necessary to investigate an attack on the service or a serious risk to someone's safety. Where we are allowed to, we will tell you.

## 6. Cookies and local storage

The panel uses a small number of functional cookies and browser storage entries, and nothing else:

- **\`gsm_token\`** — the signed session cookie that keeps you signed in. It is HttpOnly (scripts cannot read it), SameSite (it is not sent from other sites) and Secure when the panel is served over HTTPS. Signing out deletes it.
- **\`gsm_csrf\`** — a token that proves a state-changing request came from the panel itself, not from another site your browser happens to be visiting.
- **Discord sign-in state** — a short-lived cookie used only during the Discord sign-in round trip.
- **Browser storage** — your theme and language choice, the shop cart and the email address you last typed at checkout, kept on your own device so the page looks the way you left it. Clearing your browser storage deletes them; the panel does not depend on them.

There are no analytics cookies, no advertising cookies and no third-party tracking scripts.

## 7. Your content

The files, world saves, databases, configuration and console output that exist inside your servers belong to you. We store and back them up so the service can run, and we do not read them except where we must to run a feature you asked for (installing a mod, migrating a server, diagnosing a crash you reported), to investigate abuse, or where the law requires it.

Be aware that a game server may itself collect data about its players — chat logs, IP addresses, statistics — because of the game or a plugin you installed. That collection is yours to disclose to your players, not ours.

## 8. How long we keep it

- **Account details** are kept while the account exists, and deleted when it is closed.
- **Audit log entries** are kept for the retention period the operator has configured (a year by default), because their whole value is being able to look back. They are pruned automatically after that.
- **Metrics** — CPU, memory, player counts — are sampled continuously and pruned on the operator's configured schedule (30 days by default).
- **Orders and licence records** are kept for as long as tax and accounting law requires, typically five to seven years, even after an account closes.
- **Sessions** expire on the schedule the operator sets and are deleted when they expire or are revoked.
- **Backups** roll off on the operator's configured retention (10 archives per server by default). A deleted server's archives age out the same way.
- **Forum and chat content** stays while the thread or message exists; moderators may remove it, and closing an account does not always remove what was already posted.

## 9. Security

Passwords are hashed with bcrypt. Session cookies are signed, HttpOnly and revocable, and the panel lists your active sessions so you can end one you do not recognise. Sensitive values the panel must be able to read back — a Discord bot token, an FTP password — are encrypted at rest with a key held on the server. Two-factor authentication is available, and administrative actions are written to the audit log.

No service can promise perfect security. If a breach affects your personal information, we will notify you and the relevant authority as the law requires, and we will tell you what we know rather than what sounds reassuring.

## 10. Your rights

You can ask us to:

- **show you** what personal information we hold about you, and give you a copy;
- **correct** anything that is wrong — much of it you can edit yourself in your profile;
- **delete** your account and the personal information in it, subject to records we must keep (orders, tax) and to content others can still see;
- **export** your data: the panel has export tools for your servers, settings and content;
- **stop** a particular use, or withdraw a consent, where we relied on consent.

Write to {{contact}} and say what you want. We may need to confirm who you are first — otherwise anyone could ask for your file. We will respond within a reasonable time, and we will not charge you for a straightforward request.

If you are in the EU or UK, you have the corresponding rights under the GDPR (access, rectification, erasure, restriction, portability, objection, and complaint to a supervisory authority). If you are in Australia, this policy follows the Australian Privacy Principles in the Privacy Act 1988 (Cth), and you may complain to the Office of the Australian Information Commissioner if we do not resolve your complaint. Where the GDPR and this policy differ, the GDPR applies to the extent it must.

## 11. Where your data lives

This deployment runs on infrastructure chosen by the operator, in a location the operator chooses. If servers are spread across several machines in several countries, your data may be stored in more than one of them. Ask the operator if the location matters to you — for a business customer with a data-residency requirement, it usually does, and it is better asked before you upload anything.

## 12. Changes to this policy

When this policy changes, the version date at the top changes and the site shows a notice for anything material. Where a change is significant, we will ask you to accept it again before you carry on using the service. The version you accepted, and when, is recorded.

## 13. Contact

Questions, requests and complaints: {{contact}}

If you are unhappy with our answer, you can complain to the relevant regulator — in Australia, the Office of the Australian Information Commissioner (oaic.gov.au).
`;

/**
 * The date the shipped text was last revised.
 *
 * Used when no stored document exists, so a fresh install's "last updated"
 * line is a fact about the text rather than today's date — and so the version
 * fingerprint, which includes the date, does not change every midnight and
 * invalidate every acceptance captured the day before.
 */
export const DEFAULT_LEGAL_DATE = "2026-11-07";

export const DEFAULT_LEGAL_TEXTS = {
  terms: DEFAULT_TERMS_TEXT,
  privacy: DEFAULT_PRIVACY_TEXT,
} as const;
