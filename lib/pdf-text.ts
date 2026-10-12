import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync=promisify(execFile);

export async function extractPdfText(file:File){
  if(file.type&&file.type!=="application/pdf") throw new Error("File harus PDF.");
  if(file.size<=0) throw new Error("File PDF kosong.");
  if(file.size>10*1024*1024) throw new Error("Ukuran PDF maksimal 10 MB.");

  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"siap-bri-"));
  const pdfPath=path.join(dir,"statement.pdf");
  try{
    await fs.writeFile(pdfPath,Buffer.from(await file.arrayBuffer()));
    try{
      const {stdout}=await execFileAsync("pdftotext",["-layout","-enc","UTF-8",pdfPath,"-"],{maxBuffer:12*1024*1024});
      const text=String(stdout||"").trim();
      if(!text) throw new Error("PDF tidak memiliki text layer yang dapat dibaca.");
      return text;
    }catch(error:any){
      if(error?.code==="ENOENT") throw new Error("Parser PDF server belum tersedia. Install paket poppler-utils (pdftotext) lalu coba lagi.");
      throw error;
    }
  }finally{
    await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
}
