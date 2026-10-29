// Treat names and browser MIME types as hints only. Validate the binary
// container and save the recognized format so a WebP named .png still works.
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
function detectImageFormat(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<12)return null;
 if(bytes.subarray(0,8).equals(PNG)){
  let offset=8,header=false,pixels=false;
  while(offset+12<=bytes.length){
   const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8),end=offset+12+length;
   if(end>bytes.length)return null;
   if(!header){if(type!=='IHDR'||length!==13||!bytes.readUInt32BE(offset+8)||!bytes.readUInt32BE(offset+12))return null;header=true;}
   else if(type==='IHDR')return null;
   if(type==='IDAT')pixels=true;
   if(type==='IEND')return length===0&&pixels&&end===bytes.length?{mime:'image/png',extension:'png'}:null;
   offset=end;
  }
  return null;
 }
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.length>4&&bytes.at(-2)===255&&bytes.at(-1)===217){
  let offset=2,dimensions=false;
  while(offset+4<=bytes.length){
   if(bytes[offset++]!==255)return null;
   while(bytes[offset]===255)offset++;
   const marker=bytes[offset++];
   if(marker===0||marker===216||marker===217)return null;
   const length=bytes.readUInt16BE(offset);
   if(length<2||offset+length>bytes.length)return null;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
    if(length<8||!bytes.readUInt16BE(offset+3)||!bytes.readUInt16BE(offset+5))return null;
    dimensions=true;
   }
   if(marker===218)return dimensions?{mime:'image/jpeg',extension:'jpg'}:null;
   offset+=length;
  }
  return null;
 }
 if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length){
  let offset=12,frame=false;
  while(offset+8<=bytes.length){
   const type=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),start=offset+8,end=start+length;
   if(end>bytes.length)return null;
   if(type==='VP8 '){if(length<10||!bytes.subarray(start+3,start+6).equals(Buffer.from([157,1,42]))||!(bytes.readUInt16LE(start+6)&16383)||!(bytes.readUInt16LE(start+8)&16383))return null;frame=true;}
   if(type==='VP8L'){if(length<5||bytes[start]!==47)return null;frame=true;}
   if(type==='VP8X'&&length!==10)return null;
   if(type==='ANMF'&&length>=16)frame=true;
   offset=end+(length%2);
  }
  return frame&&offset===bytes.length?{mime:'image/webp',extension:'webp'}:null;
 }
 return null;
}
module.exports={detectImageFormat};
