// Rules are supplied by /api/config from server/password-policy.cjs. This module
// renders and evaluates those public rules; it never persists or logs passwords.
let passwordFieldSequence=0;
export function clientPasswordValidation(value,policy) {
  if(!policy||!Number.isInteger(policy.minLength)||!Number.isInteger(policy.maxLength)||!Array.isArray(policy.checks))return {valid:false,errors:[{id:'configuration',message:'Não foi possível carregar os requisitos de senha. Recarregue a página.'}]};
  const text=typeof value==='string'?value:'',length=Array.from(text).length;
  const checks=[{id:'length',valid:length>=policy.minLength&&length<=policy.maxLength,message:policy.lengthMessage},...policy.checks.map(rule=>({id:rule.id,valid:new RegExp(rule.pattern).test(text),message:rule.message}))];
  const errors=checks.filter(check=>!check.valid).map(({id,message})=>({id,message}));
  return {valid:typeof value==='string'&&!errors.length,errors,message:errors.map(error=>error.message).join(' '),checks};
}
export function createPasswordField({el,policy,label='Senha',name='password',mode='new',confirmationFor=null,autocomplete,required=true}) {
  const id=`bkm-password-${++passwordFieldSequence}`,newPassword=mode==='new',confirmation=mode==='confirm';
  const input=el('input',{id,name,type:'password',required,autocomplete:autocomplete||(mode==='current'?'current-password':'new-password'),autocapitalize:'none',spellcheck:false,...(mode==='current'?{maxlength:128}:{})});
  const instruction=newPassword?el('p',{id:id+'-instruction',class:'bkm-password-instruction'},policy?.instruction||'Não foi possível carregar os requisitos de senha. Recarregue a página.'):confirmation?el('p',{id:id+'-instruction',class:'bkm-password-instruction'},'Repita a mesma senha.'):null;
  const checklist=newPassword?el('ul',{id:id+'-checks',class:'bkm-password-checklist','aria-label':'Requisitos da senha'},el('li',{'data-rule':'length'},`De ${policy?.minLength??9} a ${policy?.maxLength??14} caracteres`),...(policy?.checks||[]).map(rule=>el('li',{'data-rule':rule.id},rule.label))):null;
  const feedback=el('p',{id:id+'-feedback',class:'bkm-password-feedback','aria-live':'polite','aria-atomic':'true'});
  const toggle=el('button',{type:'button',class:'bkm-password-toggle','aria-label':`Mostrar ${label.toLowerCase()}`,'aria-controls':id,'aria-pressed':'false',onClick:()=>{const show=input.type==='password';input.type=show?'text':'password';toggle.textContent=show?'Ocultar':'Mostrar';toggle.setAttribute('aria-label',`${show?'Ocultar':'Mostrar'} ${label.toLowerCase()}`);toggle.setAttribute('aria-pressed',String(show));}},'Mostrar');
  const node=el('div',{class:'bkm-password-field'},instruction,el('label',{class:'shop-field',for:id},el('span',{},label)),el('div',{class:'bkm-password-input'},input,toggle),checklist,feedback);
  input.setAttribute('aria-describedby',[instruction?.id,checklist?.id,feedback.id].filter(Boolean).join(' '));
  const update=()=>{
    let problem='';
    if(newPassword){const result=clientPasswordValidation(input.value,policy);problem=result.message||result.errors?.[0]?.message||'';for(const check of result.checks||[]){const row=checklist.querySelector(`[data-rule="${check.id}"]`);if(row){row.dataset.valid=String(check.valid);row.setAttribute('aria-label',`${row.textContent}: ${check.valid?'atendido':'pendente'}`);}}}
    else if(confirmation&&input.value!==confirmationFor?.value)problem='As senhas precisam ser iguais.';
    input.setCustomValidity(problem);input.setAttribute('aria-invalid',String(!!input.value&&!!problem));feedback.textContent=input.value?problem:'';
  };
  input.addEventListener('input',update);input.addEventListener('change',update);confirmationFor?.addEventListener('input',update);
  // A reset does not fire input; restore both checklist and confirmation state.
  queueMicrotask(()=>input.form?.addEventListener('reset',()=>queueMicrotask(update)));
  update();node.passwordInput=input;return node;
}
