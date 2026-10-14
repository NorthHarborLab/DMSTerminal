# DSM Terminal

<!-- impeccable:product-schema 1 -->

## Platform

web

Launched from Synology DSM 7.2.2, targeting DS218+ x86_64

## Users and jobs

DSM administrators connect to remote SSH servers, use interactive terminals, and transfer/manage remote files through SFTP

## Stack

Existing React, TypeScript, xterm.js, Express, ssh2 and pnpm workspace; distributed as a DSM SPK with official Node.js v22 (22.22.3-1010 or later)

## Confirmed workflows

WebSocket-first terminals with HTTP polling fallback and explicit host fingerprint verification

The user requested encrypted saved password/private-key/combined credentials, configurable color themes, uploads/downloads, and file management with detail and thumbnail views

The user confirmed a file panel alongside the terminal

## Constraints

Preserve the existing terminal identity and working transport behavior; credential encryption must use a secret rather than public DSM identity values

DSM user identity, saved credentials and file sessions must remain correctly associated
