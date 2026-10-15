import { prisma } from "@/lib/prisma";
import {
  contactPhone,
  createContact,
  getCustomers,
  type XeroContact,
} from "@/lib/xero";

export type AccountingClient = {
  id: string;
  name: string;
  email: string | null;
  contactName: string | null;
  phone: string | null;
  xeroContactId: string | null;
};

/**
 * Resolve the client's accounting identity, creating it in Xero on first use.
 *
 * This operation is shared by project and recurring invoicing. Keeping it in
 * the accounting module prevents either domain from depending on the other's
 * server actions.
 */
export async function ensureXeroContactForClient(client: AccountingClient): Promise<string> {
  if (client.xeroContactId) return client.xeroContactId;

  const contact = await createContact({
    name: client.name,
    email: client.email,
    contactName: client.contactName,
    phone: client.phone,
  });
  await prisma.client.update({
    where: { id: client.id },
    data: { xeroContactId: contact.ContactID },
  });
  return contact.ContactID;
}

/** Create or link the local customer represented by a Xero contact. */
export async function upsertClientFromXeroContact(contact: XeroContact) {
  const existing = await prisma.client.findFirst({
    where: {
      OR: [
        { xeroContactId: contact.ContactID },
        ...(contact.EmailAddress ? [{ email: contact.EmailAddress }] : []),
        { name: contact.Name },
      ],
    },
  });
  const data = {
    name: contact.Name,
    contactName: [contact.FirstName, contact.LastName].filter(Boolean).join(" ") || null,
    email: contact.EmailAddress || null,
    phone: contactPhone(contact),
    xeroContactId: contact.ContactID,
  };

  return existing
    ? prisma.client.update({ where: { id: existing.id }, data: { xeroContactId: contact.ContactID } })
    : prisma.client.create({ data });
}

/** Resolve one external contact and import/link its local customer record. */
export async function importXeroContact(contactId: string) {
  const customers = await getCustomers();
  const contact = customers.find((candidate) => candidate.ContactID === contactId);
  if (!contact) throw new Error("Xero contact not found");
  return upsertClientFromXeroContact(contact);
}
