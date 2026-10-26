import { expect, test } from 'bun:test';
import { uuid } from '../src/uuid';

test('UUID helper uses only getRandomValues on LAN and secure contexts',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto')!;
  const getRandomValues=crypto.getRandomValues.bind(crypto);
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues,randomUUID(){throw new Error('Do not use secure-context-only UUID APIs');}}});
  try {
    const ids=Array.from({length:100},uuid);
    expect(new Set(ids).size).toBe(100);
    for(const id of ids)expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }finally{Object.defineProperty(globalThis,'crypto',descriptor);}
});

test('frontend sources do not introduce direct secure-context UUID calls',async()=>{
  for(const entry of new Bun.Glob('src/**/*.ts').scanSync({cwd:import.meta.dir+'/..'})){
    const source=await Bun.file(import.meta.dir+'/../'+entry).text();
    expect(source).not.toMatch(/\brandomUUID\s*\(/);
  }
});
