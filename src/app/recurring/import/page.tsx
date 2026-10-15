import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ImportForm from "./ImportForm";

export const dynamic = "force-dynamic";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ importError?: string }>;
}) {
  const { importError } = await searchParams;
  const billedLines = await prisma.xeroInvoiceLine.count({ where: { domains: { not: null } } });

  return (
    <>
      <div className="page-head">
        <h1>Import recurring services</h1>
        <Link href="/recurring" className="btn btn-secondary">
          Back to services
        </Link>
      </div>

      {importError === "badpayload" && (
        <div className="error-msg">Something went wrong reading that file — try again.</div>
      )}

      {billedLines === 0 && (
        <div className="error-msg">
          No Xero invoice history has been scanned yet, so imported services can&apos;t be matched to
          clients automatically and will all land in the Unassigned queue. Run{" "}
          <strong>Scan invoice history</strong> from <Link href="/settings">Settings</Link> first.
        </div>
      )}

      <ImportForm />
    </>
  );
}
