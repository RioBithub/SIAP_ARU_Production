import DispositionsClient from "@/components/DispositionsClient";
import { requireUser } from "@/lib/auth";
export default async function Page(){ const user=await requireUser(); return <DispositionsClient user={user}/>; }
