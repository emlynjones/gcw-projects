# Microsoft 365 staff sign-in

This guide assumes the public app address remains `https://projects.cambrianweb.dev`. If it changes, update `AUTH_URL` and the Microsoft redirect URI together.

Microsoft 365 accounts admitted by this process have full access to GCW Projects. Access is deliberately checked twice: the account must be assigned to the Enterprise application in Microsoft Entra and its sign-in address must be present in `GCW_ADMIN_ALLOWED`. Do not add client accounts; the app does not yet enforce client-specific project permissions.

## 1. Register the application

1. Open [Microsoft Entra admin centre](https://entra.microsoft.com) with a GCW administrator account.
2. Go to **Entra ID → App registrations → New registration**.
3. Name it **GCW Projects** and choose **Accounts in this organisational directory only**.
4. Choose **Web** for the redirect URI and enter exactly:

   ```text
   https://projects.cambrianweb.dev/api/auth/callback/microsoft-entra-id
   ```

5. Register it. From **Overview**, copy:
   - **Directory (tenant) ID** into `GCW_O365_TENANT_ID`.
   - **Application (client) ID** into `GCW_O365_CLIENT_ID`.
6. Under **Authentication**, leave implicit/hybrid flows unchecked and public-client flows disabled. The app uses the server-side authorisation-code flow. See [Microsoft's registration guidance](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).

## 2. Create the client secret

1. Open **Certificates & secrets → Client secrets → New client secret**.
2. Give it a recognisable description and choose an expiry that follows GCW policy.
3. Copy the secret **Value** immediately, rather than its ID, into `GCW_O365_CLIENT_SECRET`.
4. Record its expiry and arrange rotation before that date. Keep the value in the ignored `.env` and the organisation's password manager, never in source control or chat.

## 3. Restrict access to nominated staff

1. Open **Enterprise applications → GCW Projects → Properties**.
2. Set **Assignment required?** to **Yes** and save.
3. Under **Users and groups**, assign each nominated staff member. Use **Default Access** if no named role is shown.
4. Under the app registration's **API permissions**, grant administrator consent for the delegated sign-in permissions if your tenant requires it.
5. Put the same staff Microsoft sign-in addresses (UPNs) in `GCW_ADMIN_ALLOWED`, comma-separated. The allow-list is exact and case-insensitive; it does not accept domain entries or wildcards.

Microsoft documents the assignment controls in its [access-restriction guidance](https://learn.microsoft.com/en-us/entra/identity-platform/howto-restrict-your-app-to-a-set-of-users).

## 4. Configure and deploy

Preserve all unrelated settings in `.env`, then set:

```dotenv
AUTH_URL=https://projects.cambrianweb.dev
GCW_O365_TENANT_ID=YOUR-DIRECTORY-TENANT-ID
GCW_O365_CLIENT_ID=YOUR-APPLICATION-CLIENT-ID
GCW_O365_CLIENT_SECRET='YOUR-SECRET-VALUE'
GCW_ADMIN_ALLOWED=you@yourdomain.co.uk,colleague@yourdomain.co.uk
```

Single quotes protect `$` and `#` characters in a secret when Compose reads `.env`. Then run from the repository root:

```sh
chmod 600 .env
docker compose config --quiet
docker compose up -d --build
docker compose exec gcw-projects npm run check:auth
```

The checker does not print secrets or staff addresses. Avoid posting `docker compose config` without `--quiet`, or container environment output, because those can expose secrets.

## 5. Test sign-in

1. Open a private browser window and visit `https://projects.cambrianweb.dev/login`.
2. Sign in with an account that is both assigned in Entra and listed in `GCW_ADMIN_ALLOWED`; confirm the dashboard opens.
3. Sign out and confirm a new dashboard visit returns to the login page.
4. Test an assigned staff account absent from the allow-list; it must be rejected.
5. Test an unassigned, non-Global-Administrator account; Microsoft must reject it before returning to the app.

Common failures:

| Symptom | Check |
| --- | --- |
| Redirect mismatch (`AADSTS50011`) | The registered Web URI must exactly match the callback above. |
| Account not assigned (`AADSTS50105`) | Assign it under Enterprise applications → Users and groups. |
| Invalid client secret | Use the secret Value, not its ID, and check its expiry. |
| Sign-in failed after Microsoft returns | Match the account's Microsoft sign-in address exactly in `GCW_ADMIN_ALLOWED`. |

## Client-account follow-on

Built-in client accounts and account management remain outstanding. They need a separate client role and server-side project-membership checks on every page and API operation. Until those controls exist, every authenticated account has full application access, so clients must not be assigned to the Entra application or added to `GCW_ADMIN_ALLOWED`.
