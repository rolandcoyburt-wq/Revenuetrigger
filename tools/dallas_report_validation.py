import json, os, re, sys, time
from io import BytesIO
from urllib.parse import urljoin, unquote

import requests
from bs4 import BeautifulSoup
import pandas as pd

BASE="https://aca-prod.accela.com/DALLASTX"
START="09/24/2026"
END="09/30/2026"
REPORTS={
    "issued":{"id":"8279","label":"Building Issued"},
    "submitted":{"id":"8280","label":"Building Submitted"},
}
OUT="dallas-report-validation"
os.makedirs(OUT, exist_ok=True)

UA="RevenueTrigger Dallas report validation/1.0"

def compact(s, n=4000):
    s=str(s or "")
    return s[:n]

def form_field_by_label(soup, label_text):
    for label in soup.find_all("label"):
        txt=" ".join(label.stripped_strings).strip().lower().rstrip(":")
        if txt == label_text.lower().rstrip(":"):
            return label.get("for")
    return None

def extract_showreport_urls(html, base_url):
    found=[]
    soup=BeautifulSoup(html, "html.parser")
    for tag in soup.find_all(True):
        for attr in ("href","src","action"):
            v=tag.get(attr)
            if v and "ShowReport.aspx" in v:
                found.append(urljoin(base_url, v.replace("&amp;","&")))
    for m in re.finditer(r"""(?i)(https?://[^"'<> ]*ShowReport\.aspx[^"'<> ]*|/DALLASTX/Report/ShowReport\.aspx[^"'<> ]*|ShowReport\.aspx[^"'<> ]*)""", html):
        found.append(urljoin(base_url, m.group(1).replace("&amp;","&")))
    # stable unique
    out=[]
    for u in found:
        if u not in out: out.append(u)
    return out

def response_meta(r):
    return {
        "status":r.status_code,
        "url":r.url,
        "history":[{"status":h.status_code,"url":h.url,"location":h.headers.get("location")} for h in r.history],
        "content_type":r.headers.get("content-type"),
        "content_disposition":r.headers.get("content-disposition"),
        "content_length":len(r.content),
        "cookies":r.cookies.get_dict(),
    }

def looks_binary_report(r):
    ct=(r.headers.get("content-type") or "").lower()
    cd=(r.headers.get("content-disposition") or "").lower()
    magic=r.content[:8]
    return (
        "spreadsheet" in ct or "excel" in ct or
        ".xls" in cd or ".xlsx" in cd or
        magic.startswith(b"PK\x03\x04") or magic.startswith(b"\xd0\xcf\x11\xe0")
    )

def save_response_content(key, r, suffix):
    cd=r.headers.get("content-disposition") or ""
    filename=None
    m=re.search(r'filename\*?=(?:UTF-8\'\')?["\']?([^;"\']+)', cd, re.I)
    if m:
        filename=unquote(m.group(1).strip())
    if not filename:
        ct=(r.headers.get("content-type") or "").lower()
        ext=".xlsx" if "spreadsheetml" in ct or r.content[:4]==b"PK\x03\x04" else ".xls" if "excel" in ct or r.content[:4]==b"\xd0\xcf\x11\xe0" else ".bin"
        filename=f"{key}-{suffix}{ext}"
    path=os.path.join(OUT, filename)
    with open(path,"wb") as f: f.write(r.content)
    return path

def dataframe_from_bytes(content):
    magic=content[:8]
    bio=BytesIO(content)
    if magic.startswith(b"PK\x03\x04"):
        df=pd.read_excel(bio, header=None, engine="openpyxl")
        fmt="xlsx"
    elif magic.startswith(b"\xd0\xcf\x11\xe0"):
        df=pd.read_excel(bio, header=None, engine="xlrd")
        fmt="xls"
    else:
        # some SSRS Excel exports can be HTML tables despite an xls name
        text=content.decode("utf-8","ignore")
        tables=pd.read_html(text)
        if not tables: raise ValueError("No spreadsheet/HTML table detected")
        df=tables[0]
        fmt="html-table"
    return df, fmt

def find_header_row(df):
    best=(0,-1)
    needles=("record","permit","address","status","date","project","valuation","contractor")
    for i in range(min(len(df),40)):
        vals=[str(x).strip() for x in df.iloc[i].tolist() if pd.notna(x) and str(x).strip() not in ("","nan")]
        if not vals: continue
        score=len(vals)+sum(4 for v in vals if any(n in v.lower() for n in needles))
        if score>best[1]: best=(i,score)
    return best[0]

def normalize_sheet(content):
    raw, fmt=dataframe_from_bytes(content)
    h=find_header_row(raw)
    headers=[]
    seen={}
    for idx,x in enumerate(raw.iloc[h].tolist()):
        name="" if pd.isna(x) else str(x).strip()
        if not name: name=f"column_{idx+1}"
        base=name
        seen[base]=seen.get(base,0)+1
        if seen[base]>1: name=f"{base}_{seen[base]}"
        headers.append(name)
    data=raw.iloc[h+1:].copy()
    data.columns=headers
    data=data.dropna(how="all")
    # remove repeated header rows
    if len(data):
        mask=[]
        for _,row in data.iterrows():
            eq=sum(str(row.get(col,"")).strip()==col for col in headers)
            mask.append(eq < max(2,len(headers)//3))
        data=data.loc[mask]
    return data.reset_index(drop=True), headers, fmt, h

def find_col(headers, patterns):
    for h in headers:
        low=h.lower()
        if all(p in low for p in patterns): return h
    for h in headers:
        low=h.lower()
        if any(p in low for p in patterns): return h
    return None

def field_presence(headers):
    def anykw(*kws):
        return [h for h in headers if any(k in h.lower() for k in kws)]
    return {
        "record_permit_number":anykw("record number","permit number","record #","permit #","application number"),
        "permit_application_type":anykw("record type","permit type","application type"),
        "status":anykw("status"),
        "submitted_dates":anykw("submitted","application date","applied date"),
        "issued_dates":anykw("issued","issue date"),
        "address":anykw("address","street"),
        "project_work_description":anykw("project","description","scope","work"),
        "contractor_company":anykw("contractor","company","business"),
        "owner_developer_applicant":anykw("owner","developer","applicant","contact"),
        "project_valuation":anykw("valuation","value","job cost","project cost"),
        "square_footage_area":anykw("square","sq ft","sqft","area"),
    }

def row_dicts(df, n=5):
    out=[]
    for _,row in df.head(n).iterrows():
        d={}
        for k,v in row.items():
            if pd.isna(v): continue
            s=str(v).strip()
            if s and s.lower()!="nan": d[k]=s
        out.append(d)
    return out

def exact_col(headers, name):
    for h in headers:
        if str(h).strip().lower()==name.lower():
            return h
    return None

def value_set(df, col):
    if not col or col not in df.columns: return set()
    return {str(v).strip() for v in df[col].tolist() if pd.notna(v) and str(v).strip() and str(v).lower()!="nan"}

def norm_text(v):
    return re.sub(r"\\s+"," ",str(v or "").strip().upper())

def nonempty_pct(df, col):
    if not col or col not in df.columns or not len(df): return None
    n=sum(1 for v in df[col].tolist() if pd.notna(v) and str(v).strip() and str(v).lower()!="nan")
    return round(100*n/len(df),2)

def date_bounds(df, col):
    if not col or col not in df.columns: return None
    vals=pd.to_datetime(df[col],errors="coerce").dropna()
    if vals.empty: return None
    return {"min":vals.min().strftime("%Y-%m-%d"),"max":vals.max().strftime("%Y-%m-%d"),"nonempty":int(vals.size)}

def prefix_counts(vals):
    from collections import Counter
    out=Counter()
    for v in vals:
        m=re.match(r"([A-Z]+(?:-[A-Z]+)*)",str(v).upper())
        out[m.group(1) if m else "OTHER"]+=1
    return dict(out.most_common(20))

def run_report(key, cfg, start=START, end=END, output_suffix=""):
    rid=cfg["id"]
    param_url=f"{BASE}/Report/ReportParameter.aspx?module=Building&reportID={rid}&reportType=LINK_REPORT_LIST"
    show_url=f"{BASE}/Report/ShowReport.aspx?module=Building&reportID={rid}&reportType=LINK_REPORT_LIST"
    s=requests.Session()
    s.headers.update({"User-Agent":UA,"Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"})

    g=s.get(param_url,timeout=45)
    g.raise_for_status()
    soup=BeautifulSoup(g.text,"html.parser")
    form=soup.find("form")
    if not form: raise RuntimeError("Report parameter form not found")

    start_field=form_field_by_label(soup,"Start Date")
    end_field=form_field_by_label(soup,"End Date")
    district_field=form_field_by_label(soup,"Council District")
    hidden={i.get("name"):i.get("value","") for i in form.find_all("input") if i.get("type")=="hidden" and i.get("name")}
    post=dict(hidden)
    post[start_field]=start
    post[end_field]=end
    post[district_field]="ALL"
    post["__EVENTTARGET"]="btnSave"
    post["__EVENTARGUMENT"]=""
    # preserve date-mask client-state controls if present
    for nm in list(hidden):
        if nm.endswith("_ext_ClientState"): post[nm]=hidden[nm]

    action=urljoin(param_url,form.get("action") or param_url)
    headers={"Referer":param_url,"Origin":"https://aca-prod.accela.com","Content-Type":"application/x-www-form-urlencoded"}
    p=s.post(action,data=post,headers=headers,timeout=120,allow_redirects=True)

    debug={
        "report_id":rid,
        "label":cfg["label"],
        "parameter_url":param_url,
        "show_url":show_url,
        "get":response_meta(g),
        "form_action":action,
        "fields":{"start":start_field,"end":end_field,"district":district_field},
        "hidden_fields":sorted(hidden.keys()),
        "post":response_meta(p),
    }

    # persist HTML/body for forensic review
    with open(os.path.join(OUT,f"{key}-post-body.bin"),"wb") as f:f.write(p.content)

    candidates=[]
    if looks_binary_report(p): candidates.append(("post",p))
    if "text" in (p.headers.get("content-type") or "").lower() or "html" in (p.headers.get("content-type") or "").lower():
        html=p.text
        debug["post_text_excerpt"]=compact(html)
        debug["showreport_urls"]=extract_showreport_urls(html,p.url)
    else:
        debug["showreport_urls"]=[]

    urls=debug["showreport_urls"][:]
    if show_url not in urls: urls.append(show_url)

    for idx,u in enumerate(urls):
        try:
            rr=s.get(u,headers={"Referer":p.url},timeout=180,allow_redirects=True)
            debug.setdefault("followups",[]).append({"requested":u,**response_meta(rr),"text_excerpt":compact(rr.text) if "text" in (rr.headers.get("content-type") or "").lower() else None})
            with open(os.path.join(OUT,f"{key}-followup-{idx}.bin"),"wb") as f:f.write(rr.content)
            if looks_binary_report(rr):
                candidates.append((f"followup-{idx}",rr))
                break
        except Exception as e:
            debug.setdefault("followups",[]).append({"requested":u,"error":repr(e)})

    result={"debug":debug,"ok":False}
    if candidates:
        source,rsp=candidates[-1]
        path=save_response_content(key,rsp,source)
        df,headers2,fmt,hrow=normalize_sheet(rsp.content)
        record_col=exact_col(headers2,"Record ID")
        link_col=exact_col(headers2,"DallasNow Link")
        address_col=exact_col(headers2,"Record Address")
        desc_col=exact_col(headers2,"Description of Work")
        applicant_col=exact_col(headers2,"Applicant Name")
        business_col=exact_col(headers2,"Applicant Business Name")
        status_col=exact_col(headers2,"Record Status")
        opened_col=exact_col(headers2,"Opened Date")
        issued_col=exact_col(headers2,"Issued Date")
        valuation_col=exact_col(headers2,"Valuation")
        record_ids=value_set(df,record_col)
        links=value_set(df,link_col)
        result.update({
            "ok":True,"binary_source":source,"download_path":path,"format":fmt,
            "header_row_index":hrow,"headers":headers2,"row_count":int(len(df)),
            "field_presence":field_presence(headers2),
            "record_number_column":record_col,
            "record_numbers":sorted(record_ids),
            "dallasnow_links":sorted(links),
            "record_id_prefixes":prefix_counts(record_ids),
            "date_bounds":{"opened":date_bounds(df,opened_col),"issued":date_bounds(df,issued_col)},
            "completeness":{
                "record_id_pct":nonempty_pct(df,record_col),
                "status_pct":nonempty_pct(df,status_col),
                "opened_date_pct":nonempty_pct(df,opened_col),
                "issued_date_pct":nonempty_pct(df,issued_col),
                "description_pct":nonempty_pct(df,desc_col),
                "valuation_pct":nonempty_pct(df,valuation_col),
                "applicant_name_pct":nonempty_pct(df,applicant_col),
                "applicant_business_pct":nonempty_pct(df,business_col),
                "address_pct":nonempty_pct(df,address_col)
            },
            "match_keys":{
                "addresses":sorted({norm_text(v) for v in value_set(df,address_col)}),
                "address_description":sorted({norm_text(str(row.get(address_col,"")))+"|"+norm_text(str(row.get(desc_col,""))) for _,row in df.iterrows() if address_col and desc_col and norm_text(row.get(address_col,""))}),
                "address_business":sorted({norm_text(str(row.get(address_col,"")))+"|"+norm_text(str(row.get(business_col,""))) for _,row in df.iterrows() if address_col and business_col and norm_text(row.get(address_col,""))})
            },
            "samples":row_dicts(df,5)
        })
    return result

summary={"window":{"start":START,"end":END,"council_district":"ALL"},"reports":{}}
for key,cfg in REPORTS.items():
    try:
        summary["reports"][key]=run_report(key,cfg)
    except Exception as e:
        summary["reports"][key]={"ok":False,"error":repr(e)}

issued=summary["reports"].get("issued",{})
submitted=summary["reports"].get("submitted",{})
if issued.get("ok") and submitted.get("ok"):
    a=set(issued.get("record_numbers",[])); b=set(submitted.get("record_numbers",[]))
    al=set(issued.get("dallasnow_links",[])); bl=set(submitted.get("dallasnow_links",[]))
    ia=set(issued.get("match_keys",{}).get("addresses",[])); ib=set(submitted.get("match_keys",{}).get("addresses",[]))
    iad=set(issued.get("match_keys",{}).get("address_description",[])); ibd=set(submitted.get("match_keys",{}).get("address_description",[]))
    iab=set(issued.get("match_keys",{}).get("address_business",[])); ibb=set(submitted.get("match_keys",{}).get("address_business",[]))
    summary["overlap"]={
        "record_id":{"issued_unique":len(a),"submitted_unique":len(b),"intersection":len(a&b),"sample":sorted(a&b)[:20]},
        "dallasnow_link":{"issued_unique":len(al),"submitted_unique":len(bl),"intersection":len(al&bl),"sample":sorted(al&bl)[:20]},
        "address":{"intersection":len(ia&ib),"sample":sorted(ia&ib)[:20]},
        "address_description":{"intersection":len(iad&ibd),"sample":sorted(iad&ibd)[:20]},
        "address_business":{"intersection":len(iab&ibb),"sample":sorted(iab&ibb)[:20]}
    }
else:
    summary["overlap"]={"available":False}

# Deterministic one-day window check.
summary["one_day_window"]={}
for key,cfg in REPORTS.items():
    try:
        rr=run_report(key+"-oneday",cfg,start="09/30/2026",end="09/30/2026",output_suffix="oneday")
        summary["one_day_window"][key]={
            "ok":rr.get("ok"),"row_count":rr.get("row_count"),
            "date_bounds":rr.get("date_bounds"),"error":rr.get("error")
        }
    except Exception as e:
        summary["one_day_window"][key]={"ok":False,"error":repr(e)}

def post_probe(rid, mode):
    url=f"{BASE}/Report/ReportParameter.aspx?module=Building&reportID={rid}&reportType=LINK_REPORT_LIST"
    s=requests.Session(); s.headers.update({"User-Agent":UA})
    g=s.get(url,timeout=45); soup=BeautifulSoup(g.text,"html.parser"); form=soup.find("form")
    start_field=form_field_by_label(soup,"Start Date"); end_field=form_field_by_label(soup,"End Date"); district_field=form_field_by_label(soup,"Council District")
    hidden={i.get("name"):i.get("value","") for i in form.find_all("input") if i.get("type")=="hidden" and i.get("name")}
    data=dict(hidden); data[start_field]=START; data[end_field]=END; data[district_field]="ALL"; data["__EVENTTARGET"]="btnSave"; data["__EVENTARGUMENT"]=""
    poster=s
    if mode=="no_cookies":
        poster=requests.Session(); poster.headers.update({"User-Agent":UA})
    if mode=="no_viewstate": data.pop("__VIEWSTATE",None)
    if mode=="no_csrf": data.pop("ACA_CS_FIELD",None)
    try:
        p=poster.post(url,data=data,headers={"Referer":url,"Origin":"https://aca-prod.accela.com"},timeout=60,allow_redirects=True)
        ct=(p.headers.get("content-type") or "").lower()
        txt=p.text[:3000] if ("text" in ct or "html" in ct) else ""
        return {"status":p.status_code,"url":p.url,"content_type":p.headers.get("content-type"),"length":len(p.content),
                "csrf_error":"cross-site request forgery" in txt.lower(),"viewstate_error":"viewstate" in txt.lower(),
                "showreport":"ShowReport.aspx" in txt}
    except Exception as e:
        return {"error":repr(e)}

summary["transport_probes"]={
    "full_flow_worked":bool(issued.get("ok") and submitted.get("ok")),
    "issued_no_cookies":post_probe("8279","no_cookies"),
    "issued_no_viewstate":post_probe("8279","no_viewstate"),
    "issued_no_csrf":post_probe("8279","no_csrf")
}

with open(os.path.join(OUT,"summary.json"),"w") as f: json.dump(summary,f,indent=2)
print("DALLAS_REPORT_VALIDATION_BEGIN")
print(json.dumps(summary,indent=2))
print("DALLAS_REPORT_VALIDATION_END")
