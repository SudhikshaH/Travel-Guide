import pandas as pd
from pymongo import MongoClient
df=pd.read_csv("Bangalore.csv", encoding='latin-1')
client=MongoClient("mongodb://localhost:27017/")
db=client["test_bangl_db"]
#create 2 collections: places, landmarks
places_col=db["places"]
landmarks_col=db["landmarks"]
#insert into places
unique_places=df[['Place_ID','Place_Name']].copy()
unique_places['Place_Name']=unique_places['Place_Name'].str.lower().str.strip()
places_data=unique_places.drop_duplicates().to_dict(orient='records')
places_col.insert_many(places_data)
#insert into landmarks
landmark_df=df[['Place_ID','Landmark','Latitude','Longitude', 'Description']].copy()
landmark_df['Place_Name']=unique_places['Place_Name'].str.lower().str.strip()
landmarks_data=landmark_df.to_dict(orient='records')
landmarks_col.insert_many(landmarks_data)