# Manifest

Freight, accounted for. Manifest emails your transporters for shipment updates, keeps every reply in one place, and alerts you when a shipment is late or a transporter goes quiet.

- `index.html`: the home page
- `app/`: the app (sign up, shipments, contacts, settings)
- `track/`: the private page a customer can open to see where a shipment is
- `r/`: the page a transporter lands on after tapping a button in the email
- `backend/`: the database setup (run `schema.sql`, then `schema2.sql`, in Supabase)
- `worker/`: the part that sends the emails, reads replies and sends alerts (runs on GitHub Actions every few minutes)

Secrets (never put these in a file): `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `ADMIN_EMAIL`. Add them under Settings, Secrets and variables, Actions.
