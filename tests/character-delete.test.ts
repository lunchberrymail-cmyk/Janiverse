import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { mountCharacterDelete } from '../src/character-delete';
let dom: JSDOM, root: HTMLElement, stop: () => void, completed: number;
let calls: Array<{url:string;method:string}>, response: (url: string, options: RequestInit) => Promise<any>, read: () => Promise<unknown>;
const oldDocument = globalThis.document, oldFetch = globalThis.fetch;
const settle = async () => { for(let i=0;i<30;i++) await Promise.resolve(); };
const button = (name: string) => [...root.querySelectorAll('button')].find(node=>node.textContent===name)!;
const operation = (url: string, status='completed') => ({ operationId: new URL(url,'http://localhost').searchParams.get('operation_id') ?? url.split('/').at(-1), entity:'character', entityId:'copy-2', status });
beforeEach(() => {
 dom=new JSDOM('<main></main>',{url:'http://localhost'}); globalThis.document=dom.window.document; root=document.querySelector('main')!; calls=[]; completed=0;
 read=async()=>({id:'copy-2',name:'Duplicate'});
 response=async(url)=>({ok:true,status:200,json:async()=>operation(url)});
 globalThis.fetch=(async(url, options={})=>{calls.push({url:String(url),method:options.method??'GET'}); return response(String(url),options);}) as typeof fetch;
 stop=mountCharacterDelete({characters:{get:()=>read()}} as any,root,{id:'copy-2',name:'Duplicate'},()=>{completed++;});
});
afterEach(()=>{stop();dom.window.close();globalThis.document=oldDocument;globalThis.fetch=oldFetch;});
test('opening and cancelling the selected copy confirmation never deletes anything',async()=>{
 button('Delete card').click(); expect(root.textContent).toContain('copy-2'); expect(root.textContent).toContain('its chats'); expect(root.textContent).toContain('Other saved copies'); button('Cancel').click(); await settle(); expect(calls).toEqual([]); expect(completed).toBe(0);
});
test('confirmation deletes only this record once and requires a matching completed operation',async()=>{
 response=async(url,options)=>({ok:true,status:options.method==='DELETE'?202:200,json:async()=>operation(url,options.method==='DELETE'?'accepted':'completed')});
 button('Delete card').click(); button('Delete this copy').click(); root.querySelectorAll<HTMLButtonElement>('button')[1].click(); await settle();
 expect(calls.filter(call=>call.method==='DELETE')).toHaveLength(1); expect(calls[0].url).toStartWith('/api/v1/characters/copy-2?operation_id='); expect(calls[1].url).toStartWith('/api/v1/characters/deletions/'); expect(completed).toBe(1);
});
test('a lost delete response checks the existing operation instead of deleting a second time',async()=>{
 response=async(url,options)=>{if(options.method==='DELETE')throw new Error('Lost response'); return {ok:true,status:200,json:async()=>operation(url)};};
 button('Delete card').click(); button('Delete this copy').click(); await settle(); expect(calls.map(call=>call.method)).toEqual(['DELETE','GET']); expect(completed).toBe(1);
});
test('a card that changes while confirmation is open is never deleted',async()=>{
 read=async()=>({id:'copy-1',name:'Another copy'}); button('Delete card').click(); button('Delete this copy').click(); await settle(); expect(calls).toEqual([]); expect(completed).toBe(0); expect(root.textContent).toContain('Reopen its profile');
});
test('failure does not claim deletion and a status retry never sends another DELETE',async()=>{
 response=async(url)=>({ok:true,status:200,json:async()=>operation(url,'failed')}); button('Delete card').click(); button('Delete this copy').click(); await settle(); expect(completed).toBe(0); expect(root.textContent).toContain('Deletion failed');
 button('Check deletion status').click(); await settle(); expect(calls.filter(call=>call.method==='DELETE')).toHaveLength(1); expect(completed).toBe(0);
});
test('closing during the identity check prevents a delayed destructive request',async()=>{
 let resolve!: (value:unknown)=>void; read=()=>new Promise(done=>{resolve=done;}); button('Delete card').click(); button('Delete this copy').click(); stop(); resolve({id:'copy-2',name:'Duplicate'}); await settle(); expect(calls).toEqual([]); expect(completed).toBe(0);
});
