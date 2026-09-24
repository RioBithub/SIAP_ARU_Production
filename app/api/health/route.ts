import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(){
  try{
    await db.query("SELECT 1");
    return NextResponse.json({ok:true,status:"healthy",database:"connected"});
  }catch{
    return NextResponse.json({ok:false,status:"unhealthy",database:"disconnected"},{status:503});
  }
}
