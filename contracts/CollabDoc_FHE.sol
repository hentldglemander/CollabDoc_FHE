pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedCollaborativeDocument is ZamaEthereumConfig {
    struct Document {
        string documentId;
        euint32 encryptedContent;
        address creator;
        uint256 createdAt;
        uint256 lastModified;
        address[] authorizedEditors;
        mapping(address => bool) editorAccess;
    }

    mapping(string => Document) public documents;
    string[] public documentIds;

    event DocumentCreated(string indexed documentId, address indexed creator);
    event ContentUpdated(string indexed documentId, address indexed editor);
    event AccessGranted(string indexed documentId, address indexed editor);
    event AccessRevoked(string indexed documentId, address indexed editor);

    modifier onlyDocumentCreator(string calldata documentId) {
        require(documents[documentId].creator == msg.sender, "Only creator can perform this action");
        _;
    }

    modifier onlyAuthorizedEditor(string calldata documentId) {
        require(documents[documentId].editorAccess[msg.sender], "Only authorized editors can perform this action");
        _;
    }

    constructor() ZamaEthereumConfig() {
    }

    function createDocument(
        string calldata documentId,
        externalEuint32 initialContent,
        bytes calldata contentProof
    ) external {
        require(bytes(documents[documentId].documentId).length == 0, "Document already exists");

        euint32 encryptedContent = FHE.fromExternal(initialContent, contentProof);
        require(FHE.isInitialized(encryptedContent), "Invalid encrypted content");

        Document storage newDoc = documents[documentId];
        newDoc.documentId = documentId;
        newDoc.encryptedContent = encryptedContent;
        newDoc.creator = msg.sender;
        newDoc.createdAt = block.timestamp;
        newDoc.lastModified = block.timestamp;
        newDoc.authorizedEditors = new address[](0);

        FHE.allowThis(newDoc.encryptedContent);
        FHE.makePubliclyDecryptable(newDoc.encryptedContent);

        documentIds.push(documentId);
        newDoc.editorAccess[msg.sender] = true;
        newDoc.authorizedEditors.push(msg.sender);

        emit DocumentCreated(documentId, msg.sender);
    }

    function updateDocumentContent(
        string calldata documentId,
        externalEuint32 newContent,
        bytes calldata contentProof
    ) external onlyAuthorizedEditor(documentId) {
        euint32 encryptedContent = FHE.fromExternal(newContent, contentProof);
        require(FHE.isInitialized(encryptedContent), "Invalid encrypted content");

        Document storage doc = documents[documentId];
        doc.encryptedContent = encryptedContent;
        doc.lastModified = block.timestamp;

        FHE.allowThis(doc.encryptedContent);
        FHE.makePubliclyDecryptable(doc.encryptedContent);

        emit ContentUpdated(documentId, msg.sender);
    }

    function grantEditorAccess(
        string calldata documentId,
        address editor
    ) external onlyDocumentCreator(documentId) {
        Document storage doc = documents[documentId];
        require(!doc.editorAccess[editor], "Editor already has access");

        doc.editorAccess[editor] = true;
        doc.authorizedEditors.push(editor);

        emit AccessGranted(documentId, editor);
    }

    function revokeEditorAccess(
        string calldata documentId,
        address editor
    ) external onlyDocumentCreator(documentId) {
        Document storage doc = documents[documentId];
        require(doc.editorAccess[editor], "Editor does not have access");

        delete doc.editorAccess[editor];

        for (uint i = 0; i < doc.authorizedEditors.length; i++) {
            if (doc.authorizedEditors[i] == editor) {
                doc.authorizedEditors[i] = doc.authorizedEditors[doc.authorizedEditors.length - 1];
                doc.authorizedEditors.pop();
                break;
            }
        }

        emit AccessRevoked(documentId, editor);
    }

    function getDocumentContent(string calldata documentId) external view returns (euint32) {
        require(bytes(documents[documentId].documentId).length > 0, "Document does not exist");
        return documents[documentId].encryptedContent;
    }

    function getDocumentMetadata(string calldata documentId) external view 
        returns (address creator, uint256 createdAt, uint256 lastModified, uint editorCount) 
    {
        require(bytes(documents[documentId].documentId).length > 0, "Document does not exist");
        Document storage doc = documents[documentId];
        return (doc.creator, doc.createdAt, doc.lastModified, doc.authorizedEditors.length);
    }

    function getAuthorizedEditors(string calldata documentId) external view returns (address[] memory) {
        require(bytes(documents[documentId].documentId).length > 0, "Document does not exist");
        return documents[documentId].authorizedEditors;
    }

    function checkEditorAccess(string calldata documentId, address editor) external view returns (bool) {
        require(bytes(documents[documentId].documentId).length > 0, "Document does not exist");
        return documents[documentId].editorAccess[editor];
    }

    function getAllDocumentIds() external view returns (string[] memory) {
        return documentIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


