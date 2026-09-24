"use client";

import { createContext,useCallback,useContext,useEffect,useRef,useState } from "react";

type Tone="default"|"danger"|"success";
type ConfirmOptions={
  title:string;
  message:string;
  detail?:string;
  confirmLabel?:string;
  cancelLabel?:string;
  tone?:Tone;
};
type PromptOptions=ConfirmOptions&{
  label?:string;
  placeholder?:string;
  initialValue?:string;
  required?:boolean;
  multiline?:boolean;
  inputType?:"text"|"password"|"number";
};
type SelectOptions=ConfirmOptions&{
  label?:string;
  options:Array<{value:string;label:string}>;
  initialValue?:string;
  required?:boolean;
};
type DialogState=
  |({kind:"confirm";resolve:(value:boolean)=>void}&ConfirmOptions)
  |({kind:"prompt";resolve:(value:string|null)=>void}&PromptOptions)
  |({kind:"select";resolve:(value:string|null)=>void}&SelectOptions)
  |null;

type DialogApi={
  confirm:(options:ConfirmOptions)=>Promise<boolean>;
  prompt:(options:PromptOptions)=>Promise<string|null>;
  select:(options:SelectOptions)=>Promise<string|null>;
};

const DialogContext=createContext<DialogApi|null>(null);

export function useAppDialog(){
  const ctx=useContext(DialogContext);
  if(!ctx)throw new Error("useAppDialog harus digunakan di dalam AppDialogProvider.");
  return ctx;
}

export default function AppDialogProvider({children}:{children:React.ReactNode}){
  const [dialog,setDialog]=useState<DialogState>(null);
  const [value,setValue]=useState("");
  const inputRef=useRef<HTMLInputElement|HTMLTextAreaElement|null>(null);

  const confirm=useCallback((options:ConfirmOptions)=>new Promise<boolean>(resolve=>{
    setDialog({kind:"confirm",...options,resolve});
  }),[]);
  const prompt=useCallback((options:PromptOptions)=>new Promise<string|null>(resolve=>{
    setValue(options.initialValue??"");
    setDialog({kind:"prompt",...options,resolve});
  }),[]);
  const select=useCallback((options:SelectOptions)=>new Promise<string|null>(resolve=>{
    setValue(options.initialValue??options.options[0]?.value??"");
    setDialog({kind:"select",...options,resolve});
  }),[]);

  function close(cancel=true){
    if(!dialog)return;
    if(dialog.kind==="confirm")dialog.resolve(cancel?false:true);
    else dialog.resolve(cancel?null:value.trim());
    setDialog(null);
  }

  useEffect(()=>{
    if(!dialog)return;
    const key=(e:KeyboardEvent)=>{if(e.key==="Escape")close(true)};
    window.addEventListener("keydown",key);
    const t=window.setTimeout(()=>inputRef.current?.focus(),80);
    return()=>{window.removeEventListener("keydown",key);window.clearTimeout(t)};
  },[dialog,value]);

  const api={confirm,prompt,select};
  const tone=dialog?.tone||"default";
  const icon=tone==="danger"?"!":tone==="success"?"✓":"?";
  const confirmClass=tone==="danger"?"btn btn-danger":tone==="success"?"btn btn-success":"btn btn-primary";
  const promptInvalid=(dialog?.kind==="prompt"||dialog?.kind==="select")&&dialog.required&&!value.trim();

  return <DialogContext.Provider value={api}>
    {children}
    {dialog&&<div className="app-dialog-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)close(true)}}>
      <div className={`app-dialog tone-${tone}`} role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
        <div className={`app-dialog-icon tone-${tone}`}>{icon}</div>
        <div className="app-dialog-content">
          <h3 id="app-dialog-title">{dialog.title}</h3>
          <p className="app-dialog-message">{dialog.message}</p>
          {dialog.detail&&<div className="app-dialog-detail">{dialog.detail}</div>}
          {(dialog.kind==="prompt"||dialog.kind==="select")&&<div className="app-dialog-field">
            <label>{dialog.label||"Keterangan"}{dialog.required&&<span> *</span>}</label>
            {dialog.kind==="select"
              ?<select ref={el=>{inputRef.current=el as any}} className="select" value={value} onChange={e=>setValue(e.target.value)}>{dialog.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
              :dialog.multiline
                ?<textarea ref={el=>{inputRef.current=el}} className="textarea" rows={4} value={value} placeholder={dialog.placeholder} onChange={e=>setValue(e.target.value)}/>
                :<input ref={el=>{inputRef.current=el}} className="input" type={dialog.inputType||"text"} value={value} placeholder={dialog.placeholder} onChange={e=>setValue(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!promptInvalid)close(false)}}/>
            }
          </div>}
          <div className="app-dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={()=>close(true)}>{dialog.cancelLabel||"Batal"}</button>
            <button type="button" className={confirmClass} disabled={Boolean(promptInvalid)} onClick={()=>close(false)}>{dialog.confirmLabel||"Lanjutkan"}</button>
          </div>
        </div>
      </div>
    </div>}
  </DialogContext.Provider>;
}
