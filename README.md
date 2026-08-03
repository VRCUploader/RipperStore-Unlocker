# Archived
Due to a large databreach of IPs on ripper.store and the security patches that followed, api access is now restricted for guest users. So this script will no longer work. Sorry everyone :(


# Ripper Store Unlocker

(this readme is probably longer than it needs to be but oh well)

RipperStore Unlocker is a simple tampermonkey script to reveal links and add local search on https://forum.ripper.store for guests and unauthenticated users

## What is ripper.store? Why make this script?
ripper.store used to be a SaaS that provided ripping tools for VRChat. Eventually, they transitioned into a forums-only website due to either being unable or unwilling to maintain their software stack.

Today, the forum exists as one of the largest centralized repositories of leaked and ripped VRChat assets. However, it's invite-only, and all download links are hidden behind registration. This script lets you view those hidden links if you're one of the many users without an account.

## Who is this for?

- **The privacy conscious.** NodeBB logs your registration and posting IPs and requires an
  email address to sign up. ripper.store is invite-only on top of that, so even getting an
  invite means handing over an email first.
- **Anyone without an invite.** Registration is closed unless someone provides an invite for you. 
  This script allows you to browse the forums without an account, bypassing that barrier.
- **Readers rather than posters.** If you only want to look things up, an account buys you
  nothing but a paper trail.

## Installation

1. Install the Tampermonkey browser extension: https://www.tampermonkey.net/
   *(I recommend using Firefox, since it also supports browser extensions on mobile.)*
2. Open the following URL in your browser: https://raw.githubusercontent.com/VRCUploader/ripper-store-links-revealer/refs/heads/main/ripper-store-unlocker.user.js
   If Tampermonkey is installed correctly, it will automatically detect the userscript and display the installation page.
3. Click **Install**, and you're done!

## Usage

Once installed you can now search posts on ripper.store and view links without an account

## Previews
### New Buttons
<img width="1903" height="958" alt="Screenshot_20260801_173825" src="https://github.com/user-attachments/assets/c03c861b-92e0-4136-9040-7ecfe922c5e0" />

### Search
<img width="1903" height="958" alt="Screenshot_20260801_174039" src="https://github.com/user-attachments/assets/67d52927-848d-4050-93ac-6947516e667f" />

### Unlock
<img width="1903" height="958" alt="Screenshot_20260801_174049" src="https://github.com/user-attachments/assets/ddf00805-18c7-41e4-b94f-0db96e2ec918" />

