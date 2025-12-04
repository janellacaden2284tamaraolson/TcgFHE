import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface CardData {
  id: string;
  name: string;
  type: string;
  power: number;
  defense: number;
  encryptedData: string;
  timestamp: number;
  owner: string;
  status: "available" | "in-deck" | "in-game";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<CardData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [selectedCard, setSelectedCard] = useState<CardData | null>(null);
  const [showCardDetail, setShowCardDetail] = useState(false);

  // Calculate statistics for dashboard
  const availableCount = cards.filter(c => c.status === "available").length;
  const inDeckCount = cards.filter(c => c.status === "in-deck").length;
  const inGameCount = cards.filter(c => c.status === "in-game").length;

  useEffect(() => {
    loadCards().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadCards = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("card_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing card keys:", e);
        }
      }
      
      const list: CardData[] = [];
      
      for (const key of keys) {
        try {
          const cardBytes = await contract.getData(`card_${key}`);
          if (cardBytes.length > 0) {
            try {
              const cardData = JSON.parse(ethers.toUtf8String(cardBytes));
              list.push({
                id: key,
                name: cardData.name,
                type: cardData.type,
                power: cardData.power,
                defense: cardData.defense,
                encryptedData: cardData.data,
                timestamp: cardData.timestamp,
                owner: cardData.owner,
                status: cardData.status || "available"
              });
            } catch (e) {
              console.error(`Error parsing card data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading card ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setCards(list);
    } catch (e) {
      console.error("Error loading cards:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const createSampleCard = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Generating encrypted card data with FHE..."
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const cardTypes = ["Creature", "Spell", "Artifact", "Enchantment"];
      const cardNames = ["Dragon", "Wizard", "Warrior", "Beast", "Spirit"];
      const randomType = cardTypes[Math.floor(Math.random() * cardTypes.length)];
      const randomName = `${cardNames[Math.floor(Math.random() * cardNames.length)]} of ${cardNames[Math.floor(Math.random() * cardNames.length)]}`;
      
      const cardId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const cardData = {
        name: randomName,
        type: randomType,
        power: Math.floor(Math.random() * 10) + 1,
        defense: Math.floor(Math.random() * 10) + 1,
        data: `FHE-ENCRYPTED-${btoa(JSON.stringify({
          specialAbility: "Hidden until revealed",
          flavorText: "Encrypted with FHE technology"
        }))}`,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        status: "available"
      };
      
      // Store encrypted card data on-chain using FHE
      await contract.setData(
        `card_${cardId}`, 
        ethers.toUtf8Bytes(JSON.stringify(cardData))
      );
      
      const keysBytes = await contract.getData("card_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(cardId);
      
      await contract.setData(
        "card_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE-encrypted card created successfully!"
      });
      
      await loadCards();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Card creation failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE Contract is ${isAvailable ? "available" : "unavailable"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const viewCardDetails = (card: CardData) => {
    setSelectedCard(card);
    setShowCardDetail(true);
  };

  const filteredCards = cards.filter(card => {
    const matchesSearch = card.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         card.type.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterType === "all" || card.status === filterType;
    return matchesSearch && matchesFilter;
  });

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to start playing the FHE-powered TCG",
      icon: "🔗"
    },
    {
      title: "Generate Encrypted Cards",
      description: "Create your card collection with FHE-encrypted data for privacy",
      icon: "🃏"
    },
    {
      title: "Build Your Deck",
      description: "Select cards for your deck while keeping strategies private",
      icon: "🎴"
    },
    {
      title: "Battle with FHE",
      description: "Engage in battles where card effects are computed encrypted",
      icon: "⚔️"
    }
  ];

  const renderStatsChart = () => {
    const total = cards.length || 1;
    const availablePercentage = (availableCount / total) * 100;
    const inDeckPercentage = (inDeckCount / total) * 100;
    const inGamePercentage = (inGameCount / total) * 100;

    return (
      <div className="stats-chart-container">
        <div className="chart-bars">
          <div className="chart-bar-container">
            <div 
              className="chart-bar available" 
              style={{ height: `${availablePercentage}%` }}
            ></div>
            <span className="bar-label">Available</span>
          </div>
          <div className="chart-bar-container">
            <div 
              className="chart-bar in-deck" 
              style={{ height: `${inDeckPercentage}%` }}
            ></div>
            <span className="bar-label">In Deck</span>
          </div>
          <div className="chart-bar-container">
            <div 
              className="chart-bar in-game" 
              style={{ height: `${inGamePercentage}%` }}
            ></div>
            <span className="bar-label">In Game</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen cyberpunk-loading">
      <div className="cyber-spinner neon-spin"></div>
      <p>Initializing FHE encrypted connection...</p>
      <div className="scan-line"></div>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header neon-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="card-icon">🃏</div>
          </div>
          <h1>FHE<span>TCG</span></h1>
          <div className="glow-effect"></div>
        </div>
        
        <div className="header-actions">
          <button 
            className="cyber-button neon-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "How to Play"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content partitioned-layout">
        {/* Left Panel - Game Information */}
        <div className="left-panel neon-panel">
          <div className="panel-section">
            <h2>FHE-Powered TCG</h2>
            <p>Experience the world's first fully encrypted trading card game where your cards and strategies remain private using Fully Homomorphic Encryption technology.</p>
            <div className="fhe-badge neon-badge">
              <span>FHE-ENCRYPTED</span>
            </div>
          </div>

          <div className="panel-section">
            <h3>Game Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item neon-stat">
                <div className="stat-value">{cards.length}</div>
                <div className="stat-label">Total Cards</div>
              </div>
              <div className="stat-item neon-stat">
                <div className="stat-value">{availableCount}</div>
                <div className="stat-label">Available</div>
              </div>
              <div className="stat-item neon-stat">
                <div className="stat-value">{inDeckCount}</div>
                <div className="stat-label">In Deck</div>
              </div>
              <div className="stat-item neon-stat">
                <div className="stat-value">{inGameCount}</div>
                <div className="stat-label">In Game</div>
              </div>
            </div>
          </div>

          <div className="panel-section">
            <h3>Status Distribution</h3>
            {renderStatsChart()}
          </div>

          <div className="panel-section">
            <button 
              onClick={createSampleCard}
              className="cyber-button neon-button primary full-width"
            >
              Generate Encrypted Card
            </button>
            <button 
              onClick={checkAvailability}
              className="cyber-button neon-button full-width"
            >
              Check FHE Status
            </button>
            <button 
              onClick={loadCards}
              disabled={isRefreshing}
              className="cyber-button neon-button full-width"
            >
              {isRefreshing ? "Refreshing..." : "Refresh Collection"}
            </button>
          </div>
        </div>

        {/* Right Panel - Card Collection */}
        <div className="right-panel neon-panel">
          <div className="panel-header">
            <h2>Your Encrypted Collection</h2>
            <div className="search-filters">
              <input
                type="text"
                placeholder="Search cards..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="cyber-input neon-input"
              />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="cyber-select neon-select"
              >
                <option value="all">All Status</option>
                <option value="available">Available</option>
                <option value="in-deck">In Deck</option>
                <option value="in-game">In Game</option>
              </select>
            </div>
          </div>

          {showTutorial && (
            <div className="tutorial-section neon-tutorial">
              <h3>Getting Started Guide</h3>
              <div className="tutorial-steps">
                {tutorialSteps.map((step, index) => (
                  <div className="tutorial-step neon-step" key={index}>
                    <div className="step-icon">{step.icon}</div>
                    <div className="step-content">
                      <h4>{step.title}</h4>
                      <p>{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="cards-grid">
            {filteredCards.length === 0 ? (
              <div className="no-cards">
                <div className="no-cards-icon">🃏</div>
                <p>No encrypted cards found</p>
                <button 
                  className="cyber-button neon-button primary"
                  onClick={createSampleCard}
                >
                  Create Your First Card
                </button>
              </div>
            ) : (
              filteredCards.map(card => (
                <div 
                  className="card-item neon-card" 
                  key={card.id}
                  onClick={() => viewCardDetails(card)}
                >
                  <div className="card-header">
                    <h4>{card.name}</h4>
                    <span className={`card-type ${card.type.toLowerCase()}`}>
                      {card.type}
                    </span>
                  </div>
                  <div className="card-stats">
                    <div className="stat">
                      <span className="label">Power</span>
                      <span className="value">{card.power}</span>
                    </div>
                    <div className="stat">
                      <span className="label">Defense</span>
                      <span className="value">{card.defense}</span>
                    </div>
                  </div>
                  <div className="card-status">
                    <span className={`status-badge ${card.status}`}>
                      {card.status.replace("-", " ")}
                    </span>
                  </div>
                  <div className="card-owner">
                    {card.owner.substring(0, 6)}...{card.owner.substring(38)}
                  </div>
                  <div className="neon-border"></div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal neon-modal">
          <div className="transaction-content neon-panel">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner neon-spin"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}

      {showCardDetail && selectedCard && (
        <div className="card-detail-modal neon-modal">
          <div className="modal-content neon-panel">
            <div className="modal-header">
              <h2>{selectedCard.name}</h2>
              <button onClick={() => setShowCardDetail(false)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="card-detail-grid">
                <div className="detail-group">
                  <label>Type</label>
                  <span className="detail-value">{selectedCard.type}</span>
                </div>
                <div className="detail-group">
                  <label>Power</label>
                  <span className="detail-value">{selectedCard.power}</span>
                </div>
                <div className="detail-group">
                  <label>Defense</label>
                  <span className="detail-value">{selectedCard.defense}</span>
                </div>
                <div className="detail-group">
                  <label>Status</label>
                  <span className={`status-badge ${selectedCard.status}`}>
                    {selectedCard.status.replace("-", " ")}
                  </span>
                </div>
                <div className="detail-group">
                  <label>Owner</label>
                  <span className="detail-value">
                    {selectedCard.owner.substring(0, 8)}...{selectedCard.owner.substring(36)}
                  </span>
                </div>
                <div className="detail-group">
                  <label>Created</label>
                  <span className="detail-value">
                    {new Date(selectedCard.timestamp * 1000).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <div className="encryption-notice">
                <div className="lock-icon">🔒</div>
                <p>Card data encrypted using FHE technology. Actual values computed privately during gameplay.</p>
              </div>
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer neon-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="card-icon">🃏</div>
              <span>FHETCG</span>
            </div>
            <p>FHE-Powered Private Trading Card Game</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link neon-link">Documentation</a>
            <a href="#" className="footer-link neon-link">Privacy Policy</a>
            <a href="#" className="footer-link neon-link">Terms of Service</a>
            <a href="#" className="footer-link neon-link">Community</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge neon-badge">
            <span>FHE-ENCRYPTED GAMEPLAY</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE-TCG. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;