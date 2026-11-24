"""Public search APIs that work without a browser session."""
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlencode
from xml.etree import ElementTree as ET


def fetch(url, destination=None):
    # Curl uses the system trust store and proxy settings, with no user curlrc or browser cookies.
    cmd = ['curl', '-q', '--fail', '--silent', '--show-error', '--location', '--max-time', '45',
           '--proto', '=https', '--proto-redir', '=https']
    if destination:
        cmd.extend(['--output', str(destination)])
    return subprocess.run([*cmd, url], capture_output=True, check=True).stdout


def arxiv(query, start, size):
    params = urlencode({'search_query': 'all:' + query, 'start': start, 'max_results': size})
    root = ET.fromstring(fetch('https://export.arxiv.org/api/query?' + params))
    ns = {'a':'http://www.w3.org/2005/Atom', 'os':'http://a9.com/-/spec/opensearch/1.1/'}
    items = []
    for row in root.findall('a:entry', ns):
        record = row.findtext('a:id', namespaces=ns)
        if '/abs/' not in record:
            raise ValueError('arXiv query error')
        ident = record.split('/abs/',1)[1]
        items.append(dict(id='arxiv:'+ident,title=' '.join(row.findtext('a:title',namespaces=ns).split()),
                          authors=[a.text for a in row.findall('a:author/a:name',ns)],
                          url='https://arxiv.org/abs/'+ident))
    return int(root.findtext('os:totalResults', namespaces=ns)), items


def pubmed(query, start, size):
    base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'
    def load(method, **kwargs):
        params = urlencode(dict(db='pubmed',retmode='json',tool='skku_library',**kwargs))
        return json.loads(fetch(base+method+'.fcgi?'+params))
    result = load('esearch',term=query,retstart=start,retmax=size)['esearchresult']
    ids = result['idlist']
    if not ids:
        return int(result['count']), []
    rows = load('esummary',id=','.join(ids))['result']
    return int(result['count']), [dict(id='pubmed:'+i,title=rows[i]['title'],
          authors=[a['name'] for a in rows[i].get('authors',[])],
          url='https://pubmed.ncbi.nlm.nih.gov/'+i+'/',
          doi=next((a['value'] for a in rows[i].get('articleids',[]) if a['idtype']=='doi'),None)) for i in ids]


def crossref(endpoint, **params):
    url = 'https://api.crossref.org/'+endpoint+'?'+urlencode(params)
    return json.loads(fetch(url))['message']


def members(query, size):
    try:
        result = crossref('members',query=query,rows=size)
        return dict(status='ok',total=result['total-results'],items=[
            dict(id=r['id'],name=r['primary-name']) for r in result['items']])
    except (OSError,ValueError,KeyError,subprocess.SubprocessError):
        return dict(status='error',code='source_unavailable',message='Crossref 会员目录暂不可用。')


def works(query, start, size, member):
    endpoint = f'members/{member}/works' if member else 'works'
    data = crossref(endpoint,**{'query.bibliographic':query,'offset':start,'rows':size,
                 'select':'DOI,title,author,publisher,URL,container-title'})
    return data['total-results'], [dict(id='doi:'+r['DOI'],title=next(iter(r.get('title',[])),''),
        authors=[' '.join(filter(None,[a.get('given'),a.get('family')])) or a.get('name','')
                 for a in r.get('author',[])],publisher=r.get('publisher'),url=r['URL'])
        for r in data['items']]


def search(args):
    name = args['source']
    try:
        start = (args['page']-1)*args['limit']
        if name=='crossref':
            total, items = works(args['query'],start,args['limit'],args.get('member'))
        else:
            fn = {'arxiv':arxiv,'pubmed':pubmed}[name]
            total, items = fn(args['query'],start,args['limit'])
        return dict(status='ok',source=name,query=args['query'],page=args['page'],total=total,items=items)
    except subprocess.CalledProcessError as e:
        if b'429' in (e.stderr or b''):
            return dict(status='error',code='rate_limited',message=f'{name} 限制了当前请求，请稍后重试。')
        return dict(status='error',code='source_unavailable',message=f'{name} 请求失败。')
    except (OSError, ValueError, TypeError, KeyError, ET.ParseError, subprocess.SubprocessError):
        return dict(status='error',code='source_unavailable',message=f'{name} 接口未返回有效的检索结果。')


def download_arxiv(args):
    ident = args['id'].removeprefix('arxiv:')
    if not re.fullmatch(r'(?:\d{4}\.\d{4,5}|[a-zA-Z.-]+/\d{7})(?:v\d+)?', ident):
        return dict(status='error',code='invalid_id')
    out = Path(args['out'])
    out.parent.mkdir(parents=True,exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(dir=out.parent) as tmp:
            dest = Path(tmp)/'article.pdf'
            fetch('https://arxiv.org/pdf/'+ident,dest)
            size = dest.stat().st_size
            with dest.open('rb') as f:
                if f.read(5)!=b'%PDF-':
                    raise ValueError()
                f.seek(max(0,size-8192))
                if b'%%EOF' not in f.read():
                    raise ValueError()
            os.link(dest,out)
            return dict(status='ok',id=args['id'],path=str(out),bytes=size)
    except FileExistsError:
        return dict(status='error',code='file_exists')
    except (ValueError,OSError,subprocess.SubprocessError):
        return dict(status='error',code='no_download',message='arXiv 未返回完整 PDF。')
