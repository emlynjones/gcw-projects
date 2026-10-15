import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Resolve the local identity for both Entra and credentials sessions; their
// provider user IDs are not interchangeable with the local User primary key.
export async function requireWorkUser() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Please sign in.");
  const user = await prisma.user.findUnique({
    where: { email: session.user.email.toLowerCase() },
    select: { id: true, role: true },
  });
  if (!user || !["staff", "admin"].includes(user.role))
    throw new Error("Staff access required.");
  return user;
}
