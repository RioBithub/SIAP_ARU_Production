"use client";
export default function Toast({message,type="success"}:{message:string;type?:"success"|"error"}) {
  if(!message) return null;
  return <div className={type}>{message}</div>
}
