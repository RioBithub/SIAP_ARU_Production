import AppShell from "@/components/AppShell";
import { requireSession } from "@/lib/auth";

export default async function ProtectedLayout({children}:{children:React.ReactNode}){
  const { user, owner, targetId } = await requireSession();
  return <AppShell user={user} rootName={owner.role === "ROOT_ADMIN" ? owner.name : null} targetId={targetId}>
    {children}
  </AppShell>;
}
