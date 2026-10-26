"""Upload source and test the isolated backend; never copies secrets or removes volumes."""
from pathlib import Path
import subprocess,tarfile,sys
ROOT=Path(__file__).resolve().parents[2]
generated=Path(__file__).parent/'.generated'
archive=generated/'sync-backend.tar.gz'
generated.mkdir(exist_ok=True)
with tarfile.open(archive,'w:gz') as tar:
 for path in (ROOT/'deploy').rglob('*'):
  rel=path.relative_to(ROOT/'deploy')
  if not path.is_file() or any(p in {'node_modules','secrets','.generated','.git'} for p in rel.parts) or path.name=='.env' or path.suffix in {'.pem','.db','.log'}:continue
  tar.add(path,arcname=rel.as_posix())
common=['-i',str(Path.home()/'.ssh/pos_codex'),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',f'UserKnownHostsFile={generated/"known_hosts"}']
subprocess.run(['scp',*common,str(archive),'deploy@2.28.64.69:/opt/pos/sync-backend.tar.gz'],check=True)
remote=r'''
from pathlib import Path
import os,secrets,subprocess,tarfile
base=Path('/opt/pos/staging');base.mkdir(exist_ok=True)
with tarfile.open('/opt/pos/sync-backend.tar.gz') as tar:
 for item in tar.getmembers():
  target=(base/item.name).resolve()
  if not target.is_relative_to(base) or item.issym() or item.islnk():raise SystemExit('Unsafe archive')
 tar.extractall(base,filter='data')
secret_dir=base/'secrets';secret_dir.mkdir(mode=0o700,exist_ok=True)
env=base/'.env'
if not env.exists():
 values={'DOMAIN':'pos.sml.boutique','POWERSYNC_VERSION':'1.27.2','MIN_CLIENT_VERSION':'1.9.1038','LIVE_WRITES_ENABLED':'false'}
 for name in ['PG_PASSWORD','API_DB_PASSWORD','PS_PASSWORD','PS_STORAGE_PASSWORD']:values[name]=secrets.token_hex(24)
 fd=os.open(env,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:f.write(''.join(k+'='+v+chr(10) for k,v in values.items()))
key=secret_dir/'jwt_private.pem'
if not key.exists():
 subprocess.run(['openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',str(key)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
 key.chmod(0o600)
os.chdir(base)
subprocess.run(['docker','compose','config','--quiet'],check=True)
subprocess.run(['docker','compose','up','-d','--build','postgres','api','powersync'],check=True)
subprocess.run(['docker','compose','--profile','test','run','--build','--rm','tests'],check=True)
subprocess.run(['docker','compose','ps'],check=True)
'''
result=subprocess.run(['ssh',*common,'deploy@2.28.64.69','python3','-'],input=remote,text=True)
sys.exit(result.returncode)

