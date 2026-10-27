'use strict';

// This same public data is returned by /api/config and drives the browser's
// checklist. Login deliberately does not apply a new-password policy.
const PASSWORD_POLICY=Object.freeze({
  minLength:9,maxLength:14,
  instruction:'Use de 9 a 14 caracteres, com pelo menos uma letra maiúscula (A–Z) e um número (0–9). Símbolos são opcionais.',
  lengthMessage:'A senha deve ter de 9 a 14 caracteres.',
  checks:Object.freeze([
    Object.freeze({id:'uppercase',pattern:'[A-Z]',label:'Pelo menos uma letra maiúscula (A–Z)',message:'Inclua pelo menos uma letra maiúscula de A a Z.'}),
    Object.freeze({id:'number',pattern:'[0-9]',label:'Pelo menos um número (0–9)',message:'Inclua pelo menos um número de 0 a 9.'})
  ])
});
function passwordChecks(password){
  const value=typeof password==='string'?password:'',length=Array.from(value).length;
  return [{id:'length',valid:length>=PASSWORD_POLICY.minLength&&length<=PASSWORD_POLICY.maxLength,message:PASSWORD_POLICY.lengthMessage},...PASSWORD_POLICY.checks.map(rule=>({id:rule.id,valid:new RegExp(rule.pattern).test(value),message:rule.message}))];
}
function passwordValidation(password){
  const checks=passwordChecks(password),errors=checks.filter(check=>!check.valid);
  return {valid:typeof password==='string'&&errors.length===0,errors:errors.map(({id,message})=>({id,message})),message:errors.map(error=>error.message).join(' ')};
}
function assertPassword(password,invalid){const result=passwordValidation(password);if(!result.valid)invalid(result.message);return password;}
function assertPasswordConfirmation(password,confirmation,invalid){if(confirmation!==undefined&&confirmation!==password)invalid('As senhas precisam ser iguais.');}
module.exports={PASSWORD_POLICY,passwordChecks,passwordValidation,assertPassword,assertPasswordConfirmation};
