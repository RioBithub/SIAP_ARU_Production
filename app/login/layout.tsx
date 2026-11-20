import { devStaging } from "@/lib/dev-staging";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{devStaging() && <div className="staging-banner staging-login"><strong>STAGING</strong>
    <span>Masuk dengan akun dan sandi staging SIAP ARU.</span></div>}{children}</>;
}
