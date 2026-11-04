-- Accounts are optional. A walk lives in the browser first; signing in adds a
-- copy here, so the user's other devices and their assistants can read it.
--
-- Only what the service needs is kept (see public/privacy/). No names, no IP
-- addresses, no per-second readings, no activity tracking.

CREATE TABLE users (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL UNIQUE,
	created_at INTEGER NOT NULL,
	-- Daily goal in km, and when it was last set (ms), for last-writer-wins.
	goal_km REAL,
	goal_updated INTEGER NOT NULL DEFAULT 0,
	-- IANA zone from the user's browser: days and weeks are theirs, not UTC.
	time_zone TEXT,
	-- When the user agreed to the terms and privacy notice, and which version:
	-- the record of their consent to storing walk data.
	consented_at INTEGER NOT NULL,
	policy_version TEXT NOT NULL
);

CREATE TABLE sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	token_hash TEXT NOT NULL UNIQUE,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Sign-in codes. A code works only with the browser that asked for it, and is
-- deleted when used or a day after it expires.
CREATE TABLE sign_in_codes (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL,
	browser_hash TEXT NOT NULL,
	code_hash TEXT NOT NULL,
	tries INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL
);
CREATE INDEX sign_in_codes_browser ON sign_in_codes (browser_hash);
CREATE INDEX sign_in_codes_expires ON sign_in_codes (expires_at);

-- One row per walk: totals only. Per-second readings stay in the browser.
CREATE TABLE walks (
	user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	uid TEXT NOT NULL,
	start INTEGER NOT NULL,
	"end" INTEGER,
	-- When the walk last changed on the device that changed it (ms).
	updated INTEGER NOT NULL,
	-- When this row last changed here (ms): what devices sync from.
	changed_at INTEGER NOT NULL,
	deleted INTEGER NOT NULL DEFAULT 0,
	distance REAL NOT NULL DEFAULT 0,
	seconds INTEGER NOT NULL DEFAULT 0,
	steps INTEGER NOT NULL DEFAULT 0,
	calories INTEGER NOT NULL DEFAULT 0,
	max_speed REAL NOT NULL DEFAULT 0,
	PRIMARY KEY (user_id, uid)
);
CREATE INDEX walks_changed ON walks (user_id, changed_at);
CREATE INDEX walks_start ON walks (user_id, start);

-- Counters against abuse. The subject (an email address or a network) is
-- stored only as a hash, and each row goes when its window ends.
CREATE TABLE rate_limits (
	bucket TEXT NOT NULL,
	subject TEXT NOT NULL,
	window_end INTEGER NOT NULL,
	count INTEGER NOT NULL,
	PRIMARY KEY (bucket, subject)
);
