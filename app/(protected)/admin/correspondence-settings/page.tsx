import CorrespondenceSettingsClient from "@/components/CorrespondenceSettingsClient";
import { requireRoles } from "@/lib/auth";

export default async function Page() {
  await requireRoles(["ROOT_ADMIN"]);
  return <CorrespondenceSettingsClient/>;
}
