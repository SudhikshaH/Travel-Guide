import pandas as pd
from pymongo import MongoClient
df=pd.read_csv("db_rns.csv", encoding='latin-1')
#df=pd.read_csv("C://Users//Admin//OneDrive//Desktop//travel//Travel-Guide//db_rns.csv")
client=MongoClient("mongodb://localhost:27017")
db=client["rns_db"]
#create 2 collections: places, landmarks
places_col=db["places"]
landmarks_col=db["landmarks"]
#insert into places
unique_places=df[['Place_ID','Place_Name','Boundary']].copy()
unique_places['Place_Name']=unique_places['Place_Name'].str.lower().str.strip()
unique_places['Boundary_tuple'] = unique_places['Boundary'].apply(tuple)
places_data = unique_places.drop_duplicates(subset=['Place_ID','Place_Name','Boundary_tuple']).to_dict(orient='records')
for rec in places_data:
    del rec['Boundary_tuple']
places_col.insert_many(places_data)
#insert into landmarks
landmark_df=df[['Place_ID','Landmark','Latitude','Longitude', 'Description']].copy()
landmark_df['Place_Name']=unique_places['Place_Name'].str.lower().str.strip()
landmarks_data=landmark_df.to_dict(orient='records')
landmarks_col.insert_many(landmarks_data)