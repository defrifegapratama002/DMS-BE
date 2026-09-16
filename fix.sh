#!/bin/bash

echo "Fixing documentController..."
sed -i.bak 's/error\.errors/error.issues/g' 
src/controllers/documentController.ts
sed -i.bak 's/where: { id }/where: { id: req.params.id as string }/g' 
src/controllers/documentController.ts
sed -i.bak 's/where: { documentId: id }/where: { documentId: req.params.id 
as string }/g' src/controllers/documentController.ts

echo "Fixing folderController..."
sed -i.bak 's/error\.errors/error.issues/g' 
src/controllers/folderController.ts
sed -i.bak 's/where: { id }/where: { id: req.params.id as string }/g' 
src/controllers/folderController.ts
sed -i.bak 's/entityId: id,/entityId: req.params.id as string,/g' 
src/controllers/folderController.ts

echo "Fixing userController..."
sed -i.bak 's/error\.errors/error.issues/g' 
src/controllers/userController.ts
sed -i.bak 's/password_hash/passwordHash/g' 
src/controllers/userController.ts
sed -i.bak 's/where: { id }/where: { id: req.params.id as string }/g' 
src/controllers/userController.ts

echo "Done!"
