import CorrespondenceScreen from "@/components/CorrespondenceScreen";
import { requireUser } from "@/lib/auth";

export default async function Page(){
  const user=await requireUser();
  return <CorrespondenceScreen view="INTERNAL" user={user}/>;
}
