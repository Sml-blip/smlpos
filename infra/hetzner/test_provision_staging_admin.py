import contextlib
import io
import json
import types
import unittest
from unittest.mock import patch
import provision_staging_admin as provision


class ProvisionTests(unittest.TestCase):
    def fixtures(self):
        def item(name):
            return {'Name':'/'+name,'Id':'a'*64,'Config':{'Labels':{'com.docker.compose.project':'smlpos-staging'},'Env':[]},
                    'NetworkSettings':{'Networks':{'smlpos-staging_internal':{}}},'HostConfig':{'ExtraHosts':None},'Mounts':[]}
        api=item('smlpos-staging-api-1');db=item('smlpos-staging-postgres-1')
        api['Config']['Env']=['DATABASE_URL=postgresql://pos_api:synthetic-secret@postgres:5432/smlpos_staging']
        db['Config']['Env']=['POSTGRES_DB=smlpos_staging']
        db['Mounts']=[{'Type':'volume','Name':'smlpos-staging_pgdata','Destination':'/var/lib/postgresql/data'}]
        return api,db

    def inspect(self,items):
        fake=types.SimpleNamespace(check_output=lambda *args,**kwargs:json.dumps(items))
        out=io.StringIO()
        with patch.dict('sys.modules',{'subprocess':fake}),contextlib.redirect_stdout(out):
            exec(provision.INSPECT,{})
        return out.getvalue()

    def test_only_container_id_is_printed(self):
        out=self.inspect(self.fixtures())
        self.assertEqual(out,'a'*64+'\n')
        self.assertNotIn('synthetic-secret',out)

    def test_production_database_and_network_refused(self):
        api,db=self.fixtures();api['Config']['Env']=['DATABASE_URL=postgresql://x:y@postgres:5432/pos']
        with self.assertRaises(SystemExit):self.inspect((api,db))
        api,db=self.fixtures();db['NetworkSettings']['Networks']={'pos-sync-staging_internal':{}}
        with self.assertRaises(SystemExit):self.inspect((api,db))
        api,db=self.fixtures();db['Mounts'][0]['Name']='pos-sync-staging_pgdata'
        with self.assertRaises(SystemExit):self.inspect((api,db))


if __name__=='__main__': unittest.main(verbosity=2)
