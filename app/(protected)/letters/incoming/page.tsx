import LettersClient from "@/components/LettersClient";
import { requireUser } from "@/lib/auth";
export default async function Page(){ const user=await requireUser(); return <LettersClient direction="INCOMING" user={user}/>; }
