'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PASSWORD_POLICY}=require('../server/password-policy.cjs');
const ui=import('../password-ui.js');

// This host supplies only DOM/event/native-validity behavior. Policy decisions,
// checklist updates and confirmation handling run in the production component.
class Element {
  constructor(tag,props={},children=[]){
    this.tag=tag;this.attributes={};this.dataset={};this.children=[];this.listeners=new Map();this.parentNode=null;
    this.value=props.value??'';this.defaultValue=this.value;this.validationMessage='';
    for(const[key,value]of Object.entries(props)){if(/^on[A-Z]/.test(key))this.addEventListener(key.slice(2).toLowerCase(),value);else this.setAttribute(key,value);}
    this.append(...children);
  }
  append(...children){for(const child of children.flat(Infinity)){if(child===null||child===undefined||child===false)continue;this.children.push(child);if(child instanceof Element)child.parentNode=this;}}
  setAttribute(key,value){this.attributes[key]=value;if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);else this[key]=value;}
  getAttribute(key){return this.attributes[key]??null;}
  get textContent(){return this.children.map(child=>child instanceof Element?child.textContent:String(child)).join(' ');}
  set textContent(text){this.children=[String(text)];}
  get form(){let parent=this.parentNode;while(parent&&parent.tag!=='form')parent=parent.parentNode;return parent;}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(listener);}
  dispatch(type){for(const listener of this.listeners.get(type)||[])listener({type,target:this,currentTarget:this});}
  click(){this.dispatch('click');}
  setCustomValidity(message){this.validationMessage=String(message);}
  checkValidity(){return !this.validationMessage&&!(this.required&&!this.value);}
  querySelectorAll(selector){
    const matches=node=>{const data=/^\[data-rule="([^"]+)"\]$/.exec(selector);return data?node.dataset.rule===data[1]:selector.startsWith('#')?node.id===selector.slice(1):node.tag===selector;};
    return this.children.flatMap(child=>child instanceof Element?[...(matches(child)?[child]:[]),...child.querySelectorAll(selector)]:[]);
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  reset(){assert.equal(this.tag,'form');this.dispatch('reset');for(const input of this.querySelectorAll('input'))input.value=input.defaultValue;}
}
const el=(tag,props,...children)=>new Element(tag,props,children);
const type=(input,value)=>{input.value=value;input.dispatch('input');};
const flush=()=>new Promise(resolve=>queueMicrotask(resolve));
async function fixture(options={}){const {createPasswordField}=await ui,field=createPasswordField({el,policy:PASSWORD_POLICY,...options}),form=el('form',{},field);await flush();return{field,form,input:field.passwordInput,toggle:field.querySelector('button'),feedback:field.querySelectorAll('p').at(-1)};}
const rows=field=>Object.fromEntries(field.querySelectorAll('li').map(row=>[row.dataset.rule,row.dataset.valid==='true']));

test('componente real mostra instruções antes da digitação, checklist e relações acessíveis',async()=>{
  const {field,input,feedback,toggle}=await fixture();
  assert.equal(field.children[0].textContent,PASSWORD_POLICY.instruction);
  assert.match(field.textContent,/9 a 14 caracteres/);assert.match(field.textContent,/Símbolos são opcionais/);
  assert.deepEqual(rows(field),{length:false,uppercase:false,number:false});assert.equal(feedback.textContent,'');
  assert.equal(input.type,'password');assert.equal(input.autocomplete,'new-password');assert.equal(input.required,true);
  assert.equal(input.getAttribute('maxlength'),null,'limite nativo UTF-16 não pode truncar caracteres Unicode válidos');
  assert.equal(field.querySelector('label').getAttribute('for'),input.id);
  for(const id of input.getAttribute('aria-describedby').split(' '))assert.ok(field.querySelector('#'+id),id);
  assert.equal(feedback.getAttribute('aria-live'),'polite');assert.equal(toggle.type,'button');assert.equal(toggle.getAttribute('aria-controls'),input.id);
  assert.equal(input.checkValidity(),false);
});

test('input real atualiza validade, feedback e cada item para limites e composição solicitados',async()=>{
  const {field,input,feedback}=await fixture();
  const cases=[
    ['8 rejeitados','Abcdefg1',false,{length:false,uppercase:true,number:true},/9 a 14/],
    ['9 aceitos sem símbolo','Abcdefgh1',true,{length:true,uppercase:true,number:true}],
    ['14 aceitos','Abcdefghijklm1',true,{length:true,uppercase:true,number:true}],
    ['15 rejeitados','Abcdefghijklmn1',false,{length:false,uppercase:true,number:true},/9 a 14/],
    ['só minúsculas rejeitadas','abcdefg12',false,{length:true,uppercase:false,number:true},/maiúscula de A a Z/],
    ['sem número rejeitada','Abcdefghi',false,{length:true,uppercase:true,number:false},/número de 0 a 9/],
    ['9 letras sem dígito','ABCDEFGHI',false,{length:true,uppercase:true,number:false},/número de 0 a 9/],
    ['símbolo opcional aceito','Abcdefg1!',true,{length:true,uppercase:true,number:true}],
    ['não exige minúscula','ABCDEFGH1',true,{length:true,uppercase:true,number:true}],
    ['14 codepoints com emoji','A1'+'😀'.repeat(12),true,{length:true,uppercase:true,number:true}]
  ];
  for(const[name,value,valid,expected,message]of cases){
    type(input,value);assert.equal(input.checkValidity(),valid,name);assert.equal(input.getAttribute('aria-invalid'),String(!valid),name);assert.deepEqual(rows(field),expected,name);
    if(valid){assert.equal(feedback.textContent,'',name);assert.equal(input.validationMessage,'',name);}else{assert.match(feedback.textContent,message,name);assert.equal(feedback.textContent,input.validationMessage,name);assert.ok(!feedback.textContent.includes(value),'feedback nunca reproduz a senha');}
    for(const row of field.querySelectorAll('li'))assert.match(row.getAttribute('aria-label'),row.dataset.valid==='true'?/atendido$/:/pendente$/,name);
  }
});

test('confirmação acompanha mudança da origem, mostrar/ocultar preserva valor e reset restaura checklist',async()=>{
  const {createPasswordField}=await ui,newField=createPasswordField({el,policy:PASSWORD_POLICY,label:'Nova senha'}),password=newField.passwordInput;
  const confirmation=createPasswordField({el,policy:PASSWORD_POLICY,label:'Confirme a nova senha',name:'confirmPassword',mode:'confirm',confirmationFor:password}),repeat=confirmation.passwordInput;
  const form=el('form',{},newField,confirmation);await flush();
  type(password,'Abcdefgh1');type(repeat,'Abcdefgh2');assert.equal(repeat.checkValidity(),false);assert.match(confirmation.textContent,/senhas precisam ser iguais/);
  type(repeat,'Abcdefgh1');assert.equal(repeat.checkValidity(),true);assert.equal(repeat.getAttribute('aria-invalid'),'false');
  type(password,'Abcdefgh2');assert.equal(repeat.checkValidity(),false,'editar a origem revalida uma confirmação já digitada');
  type(repeat,'Abcdefgh2');assert.equal(repeat.checkValidity(),true);
  const toggle=newField.querySelector('button');toggle.click();assert.equal(password.type,'text');assert.equal(toggle.textContent,'Ocultar');assert.equal(toggle.getAttribute('aria-pressed'),'true');assert.equal(toggle.getAttribute('aria-label'),'Ocultar nova senha');assert.equal(password.value,'Abcdefgh2');
  toggle.click();assert.equal(password.type,'password');assert.equal(toggle.textContent,'Mostrar');assert.equal(toggle.getAttribute('aria-pressed'),'false');assert.equal(password.value,'Abcdefgh2');
  form.reset();await flush();assert.equal(password.value,'');assert.equal(repeat.value,'');assert.deepEqual(rows(newField),{length:false,uppercase:false,number:false});assert.equal(newField.querySelectorAll('p').at(-1).textContent,'');assert.equal(confirmation.querySelectorAll('p').at(-1).textContent,'');assert.equal(password.checkValidity(),false);assert.equal(repeat.checkValidity(),false);
});

test('campo de login não aplica política a senha legada; novo campo sem configuração falha fechado',async()=>{
  const legacy=await fixture({mode:'current'});type(legacy.input,'oldpass8');assert.equal(legacy.input.checkValidity(),true);assert.equal(legacy.input.autocomplete,'current-password');assert.equal(legacy.field.querySelector('ul'),null);assert.equal(legacy.input.getAttribute('maxlength'),128);
  type(legacy.input,'very-long-legacy-password');assert.equal(legacy.input.checkValidity(),true);
  const missing=await fixture({policy:null});type(missing.input,'Abcdefgh1');assert.equal(missing.input.checkValidity(),false);assert.match(missing.feedback.textContent,/carregar os requisitos/);
});
