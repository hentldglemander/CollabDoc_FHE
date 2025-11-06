import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface DocumentData {
  id: string;
  title: string;
  content: string;
  encryptedValue: number;
  publicValue1: number;
  publicValue2: number;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue: number;
  version: number;
}

interface UserAction {
  type: string;
  documentId: string;
  timestamp: number;
  details: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<DocumentData[]>([]);
  const [filteredDocuments, setFilteredDocuments] = useState<DocumentData[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingDocument, setCreatingDocument] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newDocumentData, setNewDocumentData] = useState({ title: "", content: "", version: 1 });
  const [selectedDocument, setSelectedDocument] = useState<DocumentData | null>(null);
  const [userActions, setUserActions] = useState<UserAction[]>([]);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  const itemsPerPage = 6;

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadDocuments();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  useEffect(() => {
    const filtered = documents.filter(doc => 
      doc.title.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredDocuments(filtered);
    setCurrentPage(1);
  }, [searchTerm, documents]);

  const loadDocuments = async () => {
    if (!isConnected) return;
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const docsList: DocumentData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          docsList.push({
            id: businessId,
            title: businessData.name,
            content: businessData.description,
            encryptedValue: 0,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            version: Number(businessData.publicValue2) || 1
          });
        } catch (e) {
          console.error('Error loading document data:', e);
        }
      }
      
      setDocuments(docsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load documents" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const addUserAction = (type: string, documentId: string, details: string) => {
    const action: UserAction = {
      type,
      documentId,
      timestamp: Date.now(),
      details
    };
    setUserActions(prev => [action, ...prev.slice(0, 9)]);
  };

  const createDocument = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingDocument(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted document..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const contentValue = newDocumentData.content.length;
      const businessId = `doc-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, contentValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newDocumentData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        newDocumentData.version,
        0,
        newDocumentData.content
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      addUserAction("CREATE", businessId, `Created document: ${newDocumentData.title}`);
      setTransactionStatus({ visible: true, status: "success", message: "Document created successfully!" });
      
      await loadDocuments();
      setShowCreateModal(false);
      setNewDocumentData({ title: "", content: "", version: 1 });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
    } finally { 
      setCreatingDocument(false); 
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptDocument = async (documentId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const documentData = await contractRead.getBusinessData(documentId);
      if (documentData.isVerified) {
        const storedValue = Number(documentData.decryptedValue) || 0;
        addUserAction("VERIFY", documentId, `Verified document content length: ${storedValue}`);
        setTransactionStatus({ visible: true, status: "success", message: "Document already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(documentId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(documentId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadDocuments();
      addUserAction("DECRYPT", documentId, `Decrypted content length: ${clearValue}`);
      setTransactionStatus({ visible: true, status: "success", message: "Document decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Document already verified" });
        await loadDocuments();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      addUserAction("CHECK", "", "Checked contract availability");
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const paginatedDocuments = filteredDocuments.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredDocuments.length / itemsPerPage);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Secure Docs</h1>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet</h2>
            <p>Connect your wallet to access encrypted collaborative documents</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted documents...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE Secure Docs</h1>
          <span className="tagline">Encrypted Collaborative Documents</span>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="action-btn">Check Availability</button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">+ New Document</button>
          <ConnectButton />
        </div>
      </header>
      
      <div className="main-content">
        <div className="sidebar">
          <div className="search-section">
            <input
              type="text"
              placeholder="Search documents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
          
          <div className="stats-panel">
            <h3>Document Stats</h3>
            <div className="stat-item">
              <span>Total Documents</span>
              <span className="stat-value">{documents.length}</span>
            </div>
            <div className="stat-item">
              <span>Verified</span>
              <span className="stat-value">{documents.filter(d => d.isVerified).length}</span>
            </div>
            <div className="stat-item">
              <span>Your Documents</span>
              <span className="stat-value">{documents.filter(d => d.creator === address).length}</span>
            </div>
          </div>
          
          <div className="actions-panel">
            <h3>Recent Actions</h3>
            {userActions.slice(0, 5).map((action, index) => (
              <div key={index} className="action-item">
                <span className="action-type">{action.type}</span>
                <span className="action-details">{action.details}</span>
                <span className="action-time">{new Date(action.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
        
        <div className="content-area">
          <div className="documents-grid">
            {paginatedDocuments.map((doc) => (
              <div key={doc.id} className="document-card" onClick={() => setSelectedDocument(doc)}>
                <div className="card-header">
                  <h3>{doc.title}</h3>
                  <span className={`status ${doc.isVerified ? 'verified' : 'encrypted'}`}>
                    {doc.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                  </span>
                </div>
                <div className="card-content">
                  <p>{doc.content.substring(0, 100)}...</p>
                </div>
                <div className="card-meta">
                  <span>Version: {doc.version}</span>
                  <span>By: {doc.creator.substring(0, 6)}...{doc.creator.substring(38)}</span>
                </div>
                <div className="card-actions">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      decryptDocument(doc.id);
                    }}
                    className={`action-btn ${doc.isVerified ? 'verified' : ''}`}
                  >
                    {doc.isVerified ? 'View' : 'Decrypt'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          
          {totalPages > 1 && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Create New Document</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Title</label>
                <input 
                  type="text"
                  value={newDocumentData.title}
                  onChange={(e) => setNewDocumentData({...newDocumentData, title: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label>Content</label>
                <textarea 
                  value={newDocumentData.content}
                  onChange={(e) => setNewDocumentData({...newDocumentData, content: e.target.value})}
                  rows={4}
                />
                <div className="hint">Content length will be encrypted with FHE</div>
              </div>
              <div className="form-group">
                <label>Version</label>
                <input 
                  type="number"
                  value={newDocumentData.version}
                  onChange={(e) => setNewDocumentData({...newDocumentData, version: parseInt(e.target.value) || 1})}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button 
                onClick={createDocument}
                disabled={creatingDocument || !newDocumentData.title || !newDocumentData.content}
              >
                {creatingDocument ? 'Creating...' : 'Create Document'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedDocument && (
        <div className="modal-overlay">
          <div className="document-modal">
            <div className="modal-header">
              <h2>{selectedDocument.title}</h2>
              <button onClick={() => setSelectedDocument(null)} className="close-btn">&times;</button>
            </div>
            <div className="modal-body">
              <div className="document-info">
                <div className="info-row">
                  <span>Creator:</span>
                  <span>{selectedDocument.creator}</span>
                </div>
                <div className="info-row">
                  <span>Created:</span>
                  <span>{new Date(selectedDocument.timestamp * 1000).toLocaleString()}</span>
                </div>
                <div className="info-row">
                  <span>Status:</span>
                  <span className={selectedDocument.isVerified ? 'verified' : 'encrypted'}>
                    {selectedDocument.isVerified ? 'Verified' : 'Encrypted'}
                  </span>
                </div>
                {selectedDocument.isVerified && (
                  <div className="info-row">
                    <span>Content Length:</span>
                    <span>{selectedDocument.decryptedValue} characters</span>
                  </div>
                )}
              </div>
              
              <div className="document-content">
                <h3>Content</h3>
                <div className="content-area">
                  {selectedDocument.content}
                </div>
              </div>
              
              <div className="fhe-info">
                <h4>FHE Encryption Details</h4>
                <p>Document content length is encrypted using Zama FHE technology</p>
                <div className="encryption-status">
                  {selectedDocument.isVerified ? (
                    <span className="verified-badge">✅ On-chain Verified</span>
                  ) : (
                    <span className="encrypted-badge">🔒 Encrypted (Click Decrypt to verify)</span>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setSelectedDocument(null)}>Close</button>
              {!selectedDocument.isVerified && (
                <button onClick={() => decryptDocument(selectedDocument.id)}>
                  Verify Decryption
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          {transactionStatus.message}
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <p>FHE Secure Documents - Encrypted Collaborative Document System</p>
          <div className="footer-links">
            <span>Powered by Zama FHE</span>
            <span>•</span>
            <span>Enterprise Grade Security</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;


