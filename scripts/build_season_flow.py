"""Extract the four non-cumulative 2025 quarters from two official Rosstat workbooks."""

import argparse
import json
from pathlib import Path

import openpyxl

REGIONS = """MOW г.Москва
LED г.Санкт-Петербург
UFA Республика Башкортостан
KUF Самарская область
AER,KRR,GDZ,AAQ Краснодарский край
MRV,STW Ставропольский край
MCX Республика Дагестан
KZN,NBC Республика Татарстан
KGD Калининградская область
OMS Омская область
SVX Свердловская область
ULY Ульяновская область
TOF Томская область
RTW Саратовская область
GOJ Нижегородская область
REN,OSW Оренбургская область
TJM,RMZ Тюменская область (кроме
CEK,MQF Челябинская область
ARH Архангельская область (кроме
PEE Пермский край
VOG Волгоградская область
BAX Алтайский край
RGK Республика Алтай
KJA,NSK Красноярский край
NOZ,KEJ Кемеровская область
SGC,HMA,NJC,NYA Ханты-Мансийский автономный округ
CSY Чувашская Республика
IJK Удмуртская Республика
MMK,KVK Мурманская область
IAR Ярославская область
KVX Кировская область
NAL Кабардино-Балкарская Республика
IKT,BTK Иркутская область
PKV Псковская область
SKX Республика Мордовия
ASF Астраханская область
PEZ Пензенская область
NOJ,NUX,SLY Ямало-Ненецкий автономный округ
ABA Республика Хакасия
KYZ Республика Тыва
OVB Новосибирская область
IGT Республика Ингушетия
VVO Приморский край
UUS Сахалинская область
KHV Хабаровский край
GDX Магаданская область
PKC Камчатский край
BQS Амурская область
HTA Забайкальский край
YKS Республика Саха
UUD Республика Бурятия
GRV Чеченская Республика
OGZ Республика Северная Осетия
VOZ Воронежская область
EYA,TYD Амурская область
KSZ,LDG,МЗН Архангельская область (кроме Ненецкого автономного округа)
EGO,СОЛ Белгородская область
BZK Брянская область
ВЛМ Владимирская область
CEE,VGD,VUS Вологодская область
АУР Еврейская автономная область
CZR,ГЗВ,КНК,КРЯ,КСЧ,КЫР,МЗА,ТГК,УСГ,УСУ,ЮМР Забайкальский край
IWA Ивановская область
ERG,KCK,ODO,UIK,UKX,КЗЧ,МАМ,ХЖР Иркутская область
KLF Калужская область
НИК,ОЗР,ОСО,ПАН,СБО,ТИГ,УКЧ,УХЙ Камчатский край
KMW Костромская область
BGS,BKA,GOY,HTG,IAA,KNY,MJY,SES,TGP,THX,VAQ,VEO,YAE,ШУШ Красноярский край
KRO Курганская область
URS Курская область
LPK Липецкая область
SWV,ОСУ,СМЧ,СНГ,ССМ,УОМ,ЯГО Магаданская область
NNM Ненецкий автономный округ
DHG,DLR,ETL,KVR,NEI,TLY Приморский край
БИХ,УКО Республика Алтай
NZG,TKM Республика Бурятия
ESL Республика Калмыкия
CSH,PES Республика Карелия
INA,PEX,SCW,UCT,USK,UTS,VKT Республика Коми
JOK Республика Марий Эл
BGN,BQJ,CKH,CYX,DPT,GYG,MJZ,MQJ,NER,NYR,OLZ,ONK,PYJ,SEK,SUK,SUY,SYS,TLK,UKG,ULK,UMS,USR,VHV,VYI,ZIX,ZKP,САГ Республика Саха (Якутия)
UUA Республика Татарстан
ROV,TGK Ростовская область
DEE,EKS,ITU,KRV,NGK,OHH,ZZO,КБЗ,ПАЙ,СМХ Сахалинская область
TBW Тамбовская область
SWT,ЖЕЗ Томская область
ВАГ,КГЬ,ЛАЙ Тюменская область (кроме Ханты-Мансийского автономного округа-Югры и Ямало-Ненецкого автономного округа)
BQG,GVN,KXK,NLI,OHO,АЯН,НЛН,ХРП,ЧГД,ЧМИ Хабаровский край
EYK,EZV,IRM,KGP,OVS,URJ Ханты-Мансийский автономный округ - Югра
DYR,KPW,KVM,PWE,ЗЛА,ООЛ,ЭГТ Чукотский автономный округ
BVJ,KKQ,NYM,SBT,TQL,МУЖ,ТЬК,ЯМБ Ямало-Ненецкий автономный округ
DKS Красноярский край
IKS Республика Саха
RZH Приморский край
БНГ Чукотский автономный округ
МИЛ,ПАЧ,ТИЛ Камчатский край"""


def rows(file, sheet, k):
    w = openpyxl.load_workbook(file, data_only=True, read_only=True)
    out = {}
    for row in w[sheet].values:
        key, *cols = row
        if (
            isinstance(key, str)
            and len(cols) >= 4
            and all(isinstance(v, (float, int)) for v in cols[:4])
        ):
            num = [round(v * k) for v in cols[:4]]
            q = [v - (num[i - 1] if i else 0) for i, v in enumerate(num)]
            if min(q) >= 0 and all(q):
                out[key.strip()] = q
    return out


p = argparse.ArgumentParser()
p.add_argument("regional", type=Path)
p.add_argument("outbound", type=Path)
args = p.parse_args()
root = Path(__file__).resolve().parents[1]
r = rows(args.regional, "2.1.2025", 1)
f = rows(args.outbound, "2.2025", 1000)
reg = {}
for line in REGIONS.splitlines():
    codes, region = line.split(" ", 1)
    name = next(k for k in r if k == region or k.startswith(region))
    for c in codes.split(","):
        reg[c] = name
normalize = lambda s: s.lower().replace("ё", "е").strip()
countries = {normalize(k): k for k in f}
aliases = {
    "AE": "Объединенные Арабские Эмираты",
    "US": "США",
    "GB": "Соединенное Королевство",
    "KG": "Киргизия",
    "KR": "Республика Корея",
    "CZ": "Чехия",
}
air = json.load((root / "backend/app/airports.json").open())
abroad = {}
for a in air:
    cc = a["country_code"]
    key = countries.get(normalize(aliases.get(cc, a["country"]) or ""))
    if key and cc != "RU":
        abroad[cc] = key
countries = {name: f[name] for name in sorted(set(abroad.values()))}
out = {
    "regions": reg,
    "regional": {name: r[name] for name in sorted(set(reg.values()))},
    "countries": abroad,
    "outbound": countries,
}
(root / "backend/app/season_flow.json").write_text(
    json.dumps(out, ensure_ascii=False, indent=1) + "\n"
)
print(
    "Flow coverage",
    len(reg),
    len(abroad),
    {i: abroad.get(i) for i in ["AE", "KG", "BY", "AZ"]},
)
