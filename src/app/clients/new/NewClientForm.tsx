"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/app/actions";
import { importOneXeroContact } from "@/app/xero-actions";
import XeroClientSearch, { type XeroContactLite } from "@/app/components/XeroClientSearch";

export default function NewClientForm({
  xeroConnected,
  xeroContacts,
}: {
  xeroConnected: boolean;
  xeroContacts: XeroContactLite[];
}) {
  const router = useRouter();

  return (
    <>
      {xeroConnected && (
        <div className="card">
          <h2>From Xero</h2>
          <p className="muted small">Search your Xero contacts and bring one across as a client.</p>
          <XeroClientSearch
            contacts={xeroContacts}
            importAction={importOneXeroContact}
            onImported={(client) => router.push(`/clients/${client.id}`)}
          />
        </div>
      )}

      <div className="card">
        <h2>{xeroConnected ? "Or enter manually" : "Details"}</h2>
        <form action={createClient} className="stack">
          <div className="field">
            <label htmlFor="name">Company / organisation name</label>
            <input id="name" name="name" required />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="contactName">Contact name</label>
              <input id="contactName" name="contactName" />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input id="phone" name="phone" />
            </div>
          </div>
          <div>
            <button type="submit" className="btn">
              Create client
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
