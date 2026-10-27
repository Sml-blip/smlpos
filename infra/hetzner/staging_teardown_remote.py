"""Remove only verified smlpos-staging Docker resources."""
import json, subprocess
def run(*args): return subprocess.check_output(args,text=True)
project='smlpos-staging'
ids=run('docker','ps','-aq','--no-trunc').splitlines()
items=json.loads(run('docker','inspect',*ids)) if ids else []
targets=[]
for item in items:
 name=item['Name'].lstrip('/')
 labels=item.get('Config',{}).get('Labels') or {}
 if labels.get('com.docker.compose.project') == project or name.startswith(project):
  if labels.get('com.docker.compose.project') != project or name not in {project+'-api-1',project+'-postgres-1'}:
   raise SystemExit('Refusing unexpected staging container: '+name)
  for m in item.get('Mounts',[]):
   if m['Type']=='volume' and m.get('Name') != project+'_pgdata': raise SystemExit('Refusing unexpected volume')
   if m['Type']=='bind' and not m.get('Source','').startswith('/opt/smlpos-staging/'): raise SystemExit('Refusing unexpected bind')
  attached=set(item['NetworkSettings']['Networks'])
  if attached not in (set(),{project+'_internal'}): raise SystemExit('Refusing unexpected network')
  if item['State']['Running'] and attached != {project+'_internal'}: raise SystemExit('Running staging container has no isolated network')
  targets.append(item['Id'])
 else:
  for m in item.get('Mounts',[]):
   if m['Type']=='volume' and m.get('Name')==project+'_pgdata': raise SystemExit('Staging volume attached elsewhere')
  if project+'_internal' in item['NetworkSettings']['Networks']: raise SystemExit('Staging network attached elsewhere')
volumes=run('docker','volume','ls','-q').splitlines()
networks=run('docker','network','ls','--format','{{.Name}}').splitlines()
for kind,name,existing in [('volume',project+'_pgdata',volumes),('network',project+'_internal',networks)]:
 if name in existing:
  label=run('docker',kind,'inspect','--format','{{ index .Labels "com.docker.compose.project" }}',name).strip()
  if label!=project: raise SystemExit('Refusing unlabelled '+kind+': '+name)
if targets: subprocess.run(['docker','rm','-f',*targets],check=True)
if project+'_pgdata' in volumes: subprocess.run(['docker','volume','rm',project+'_pgdata'],check=True)
if project+'_internal' in networks: subprocess.run(['docker','network','rm',project+'_internal'],check=True)
print('Verified staging containers, volume and network removed.')
