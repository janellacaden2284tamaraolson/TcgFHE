// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TcgFHE is SepoliaConfig {
    struct EncryptedCard {
        uint256 cardId;
        euint32 encryptedType;      // Encrypted card type
        euint32 encryptedAttack;    // Encrypted attack value
        euint32 encryptedDefense;   // Encrypted defense value
        euint32 encryptedEffect;    // Encrypted special effect
        uint256 ownerId;
    }

    struct EncryptedGameState {
        uint256 gameId;
        euint32 encryptedPlayer1Hand; // Encrypted player 1 hand cards
        euint32 encryptedPlayer2Hand; // Encrypted player 2 hand cards
        euint32 encryptedBoardState; // Encrypted board state
        uint256 turnCount;
        uint256 lastMoveTime;
    }

    struct DecryptedMove {
        uint32 cardId;
        uint32 target;
        uint32 position;
        bool isRevealed;
    }

    uint256 public gameCount;
    uint256 public cardCount;
    mapping(uint256 => EncryptedCard) public encryptedCards;
    mapping(uint256 => EncryptedGameState) public encryptedGames;
    mapping(uint256 => DecryptedMove) public decryptedMoves;
    
    mapping(uint256 => uint256) private requestToGameId;
    mapping(uint256 => uint256) private moveRequestToId;
    
    event GameCreated(uint256 indexed gameId, uint256 player1, uint256 player2);
    event MoveSubmitted(uint256 indexed gameId, uint256 moveId);
    event MoveProcessed(uint256 indexed moveId);
    event MoveDecrypted(uint256 indexed moveId);

    modifier onlyPlayer(uint256 gameId) {
        // Add proper player verification in production
        _;
    }

    function createEncryptedCard(
        euint32 encryptedType,
        euint32 encryptedAttack,
        euint32 encryptedDefense,
        euint32 encryptedEffect,
        uint256 ownerId
    ) public {
        cardCount += 1;
        uint256 newCardId = cardCount;
        
        encryptedCards[newCardId] = EncryptedCard({
            cardId: newCardId,
            encryptedType: encryptedType,
            encryptedAttack: encryptedAttack,
            encryptedDefense: encryptedDefense,
            encryptedEffect: encryptedEffect,
            ownerId: ownerId
        });
    }

    function startNewGame(
        euint32 encryptedPlayer1Deck,
        euint32 encryptedPlayer2Deck
    ) public {
        gameCount += 1;
        uint256 newGameId = gameCount;
        
        encryptedGames[newGameId] = EncryptedGameState({
            gameId: newGameId,
            encryptedPlayer1Hand: encryptedPlayer1Deck,
            encryptedPlayer2Hand: encryptedPlayer2Deck,
            encryptedBoardState: FHE.asEuint32(0),
            turnCount: 0,
            lastMoveTime: block.timestamp
        });
        
        emit GameCreated(newGameId, 0, 0); // Placeholder player IDs
    }

    function submitEncryptedMove(
        uint256 gameId,
        euint32 encryptedCardId,
        euint32 encryptedTarget,
        euint32 encryptedPosition
    ) public onlyPlayer(gameId) {
        EncryptedGameState storage game = encryptedGames[gameId];
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(encryptedCardId);
        ciphertexts[1] = FHE.toBytes32(encryptedTarget);
        ciphertexts[2] = FHE.toBytes32(encryptedPosition);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.processMove.selector);
        requestToGameId[reqId] = gameId;
    }

    function processMove(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 gameId = requestToGameId[requestId];
        require(gameId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32 cardId, uint32 target, uint32 position) = abi.decode(cleartexts, (uint32, uint32, uint32));
        
        // Simulate FHE game logic (in production this would be done off-chain)
        uint256 newMoveId = gameId * 1000 + encryptedGames[gameId].turnCount;
        
        encryptedGames[gameId].turnCount += 1;
        encryptedGames[gameId].lastMoveTime = block.timestamp;
        
        decryptedMoves[newMoveId] = DecryptedMove({
            cardId: cardId,
            target: target,
            position: position,
            isRevealed: false
        });
        
        emit MoveProcessed(newMoveId);
    }

    function requestMoveDecryption(uint256 moveId) public {
        require(!decryptedMoves[moveId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(FHE.asEuint32(decryptedMoves[moveId].cardId));
        ciphertexts[1] = FHE.toBytes32(FHE.asEuint32(decryptedMoves[moveId].target));
        ciphertexts[2] = FHE.toBytes32(FHE.asEuint32(decryptedMoves[moveId].position));
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptMove.selector);
        moveRequestToId[reqId] = moveId;
    }

    function decryptMove(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 moveId = moveRequestToId[requestId];
        require(moveId != 0, "Invalid request");
        
        DecryptedMove storage dMove = decryptedMoves[moveId];
        require(!dMove.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32 cardId, uint32 target, uint32 position) = abi.decode(cleartexts, (uint32, uint32, uint32));
        
        dMove.cardId = cardId;
        dMove.target = target;
        dMove.position = position;
        dMove.isRevealed = true;
        
        emit MoveDecrypted(moveId);
    }

    function getDecryptedMove(uint256 moveId) public view returns (
        uint32 cardId,
        uint32 target,
        uint32 position,
        bool isRevealed
    ) {
        DecryptedMove storage m = decryptedMoves[moveId];
        return (m.cardId, m.target, m.position, m.isRevealed);
    }

    function getEncryptedCard(uint256 cardId) public view returns (
        euint32 cardType,
        euint32 attack,
        euint32 defense,
        euint32 effect,
        uint256 ownerId
    ) {
        EncryptedCard storage c = encryptedCards[cardId];
        return (c.encryptedType, c.encryptedAttack, c.encryptedDefense, c.encryptedEffect, c.ownerId);
    }

    function getEncryptedGameState(uint256 gameId) public view returns (
        euint32 player1Hand,
        euint32 player2Hand,
        euint32 boardState,
        uint256 turnCount,
        uint256 lastMoveTime
    ) {
        EncryptedGameState storage g = encryptedGames[gameId];
        return (g.encryptedPlayer1Hand, g.encryptedPlayer2Hand, g.encryptedBoardState, g.turnCount, g.lastMoveTime);
    }

    // Helper functions for demo purposes
    function validateMove(uint32 cardId, uint32 target, uint32 position) private pure returns (bool) {
        // Simplified move validation
        return position < 10 && target < 100;
    }

    function calculateDamage(uint32 attack, uint32 defense) private pure returns (uint32) {
        // Simplified damage calculation
        return attack > defense ? attack - defense : 0;
    }
}