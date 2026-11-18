import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import { RestoreAccountButton } from "@/components/AccountSwitcher";

export default async function RestoreAccountPage() {
  const session = await getAuthSession();
  if (!session) redirect("/login");
  if (!session.targetId || session.user) redirect("/dashboard");

  return <main className="login-page">
    <section className="login-card">
      <div className="login-brand">
        <img src="/aru-logo.png" alt="ARU"/>
        <div><h1>Akses akun berakhir</h1><p>{session.owner.name}</p></div>
      </div>
      <RestoreAccountButton targetId={session.targetId}>Kembali ke akun sendiri</RestoreAccountButton>
    </section>
  </main>;
}
