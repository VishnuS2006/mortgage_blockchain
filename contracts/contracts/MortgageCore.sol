// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPropertyEscrow {
    function lockProperty(address nftContract, uint256 tokenId, address borrower) external;
    function releaseToBorrower(address nftContract, uint256 tokenId) external;
    function seizeToLender(address nftContract, uint256 tokenId, address lender) external;
}

interface ILoanRepayment {
    function generateEMISchedule(
        uint256 loanId,
        uint256 totalPayable,
        uint256 durationMonths,
        uint256 firstDueDate
    ) external;

    function payEMI(uint256 loanId, uint256 emiIndex)
        external
        payable
        returns (uint256 amount, uint256 nextDueDate);

    function getPendingEMI(uint256 loanId)
        external
        view
        returns (uint256 emiIndex, uint256 amount, uint256 dueDate, bool overdue);

    function getLoanEMIs(uint256 loanId) external view returns (LoanRepayment.EMI[] memory);

    function checkDefault(uint256 loanId) external view returns (bool);
}

interface IVerification {
    function verifyProperty(address nftContract, uint256 tokenId) external;
    function isPropertyVerified(address nftContract, uint256 tokenId) external view returns (bool);
}

library LoanRepayment {
    struct EMI {
        uint256 amount;
        uint256 dueDate;
        bool paid;
        uint256 paidAt;
    }
}

contract MortgageCore is Ownable, ReentrancyGuard {
    using Address for address payable;

    enum LoanStatus {
        Pending,
        Approved,
        Rejected,
        Active,
        Completed,
        Defaulted,
        Cancelled
    }

    struct Loan {
        uint256 id;
        bool exists;
        address borrower;
        address lender;
        address reviewedBy;
        uint256 nftId;
        address nftContract;
        uint256 loanAmount;
        uint256 interestRate;
        uint256 durationMonths;
        uint256 emiAmount;
        uint256 totalPayable;
        uint256 amountPaid;
        uint256 remainingBalance;
        uint256 emisPaid;
        uint256 nextDueDate;
        uint256 createdAt;
        bool approved;
        bool funded;
        LoanStatus status;
    }

    uint256 private _nextLoanId = 1;

    address public escrowContract;
    address public repaymentContract;
    address public verificationContract;
    address public automationContract;

    mapping(uint256 => Loan) public loans;
    mapping(address => uint256[]) public borrowerLoans;
    mapping(address => bool) public authorizedLenders;

    event LenderAuthorizationUpdated(address indexed lender, bool authorized);
    event ModulesUpdated(address indexed escrow, address indexed repayment, address indexed verification);
    event AutomationUpdated(address indexed automation);
    event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 amount, uint256 interestRate);
    event LoanApplied(uint256 indexed loanId, address indexed borrower, uint256 nftId, uint256 amount);
    event LoanVerified(uint256 indexed loanId, address indexed lender);
    event LoanApproved(uint256 indexed loanId, address indexed lender);
    event LoanRejected(uint256 indexed loanId, address indexed lender);
    event LoanFunded(uint256 indexed loanId, address indexed lender, uint256 amount);
    event EMIPaid(uint256 indexed loanId, uint256 indexed emiIndex, uint256 amount);
    event LoanCompleted(uint256 indexed loanId, address indexed borrower);
    event LoanDefaulted(uint256 indexed loanId, address indexed borrower, address indexed lender);
    event LoanCancelled(uint256 indexed loanId, address indexed borrower);

    modifier validLoan(uint256 loanId) {
        require(loans[loanId].exists, "Loan not found");
        _;
    }

    modifier onlyBorrower(uint256 loanId) {
        require(loans[loanId].borrower == msg.sender, "Only borrower");
        _;
    }

    modifier onlyLender() {
        require(authorizedLenders[msg.sender], "Only lender");
        _;
    }

    modifier onlyAutomation() {
        require(msg.sender == automationContract, "Only automation");
        _;
    }

    constructor(
        address[] memory initialLenders,
        address escrowAddress,
        address repaymentAddress,
        address verificationAddress
    ) Ownable(msg.sender) {
        _setModules(escrowAddress, repaymentAddress, verificationAddress);

        for (uint256 index = 0; index < initialLenders.length; index++) {
            _setLenderAuthorization(initialLenders[index], true);
        }
    }

    function setModules(
        address escrowAddress,
        address repaymentAddress,
        address verificationAddress
    ) external onlyOwner {
        _setModules(escrowAddress, repaymentAddress, verificationAddress);
    }

    function setAutomationContract(address newAutomation) external onlyOwner {
        require(newAutomation != address(0), "Invalid automation");
        automationContract = newAutomation;
        emit AutomationUpdated(newAutomation);
    }

    function setLenderAuthorization(address lender, bool isAuthorized) external onlyOwner {
        _setLenderAuthorization(lender, isAuthorized);
    }

    function createLoan(uint256 amount, uint256 interestRate) external returns (uint256) {
        uint256 loanId = _createLoan(msg.sender, address(0), 0, amount, interestRate, 12);
        emit LoanCreated(loanId, msg.sender, amount, interestRate);
        return loanId;
    }

    function applyLoan(
        address nftContract,
        uint256 nftId,
        uint256 loanAmount,
        uint256 interestRate,
        uint256 durationMonths
    ) external returns (uint256) {
        require(escrowContract != address(0), "Escrow not configured");
        require(nftContract != address(0), "NFT contract required");
        require(nftId > 0, "NFT id required");

        IPropertyEscrow(escrowContract).lockProperty(nftContract, nftId, msg.sender);

        uint256 loanId = _createLoan(
            msg.sender,
            nftContract,
            nftId,
            loanAmount,
            interestRate,
            durationMonths
        );

        emit LoanApplied(loanId, msg.sender, nftId, loanAmount);
        return loanId;
    }

    function verifyPropertyForLoan(uint256 loanId) external onlyLender validLoan(loanId) {
        Loan storage loan = loans[loanId];
        require(loan.nftContract != address(0), "Loan has no collateral");
        require(verificationContract != address(0), "Verification not configured");

        IVerification(verificationContract).verifyProperty(loan.nftContract, loan.nftId);
        emit LoanVerified(loanId, msg.sender);
    }

    function approveLoan(uint256 loanId) external onlyLender validLoan(loanId) {
        Loan storage loan = loans[loanId];

        require(loan.status == LoanStatus.Pending, "Loan not pending");
        require(!loan.approved, "Already approved");
        require(loan.nftContract != address(0), "Collateral required");
        require(
            IVerification(verificationContract).isPropertyVerified(loan.nftContract, loan.nftId),
            "Property not verified"
        );

        loan.approved = true;
        loan.reviewedBy = msg.sender;
        loan.status = LoanStatus.Approved;

        emit LoanApproved(loanId, msg.sender);
    }

    function rejectLoan(uint256 loanId) external onlyLender validLoan(loanId) {
        Loan storage loan = loans[loanId];

        require(
            loan.status == LoanStatus.Pending ||
                (loan.status == LoanStatus.Approved && loan.reviewedBy == msg.sender),
            "Loan not reviewable"
        );
        require(!loan.funded, "Loan already funded");

        loan.approved = false;
        loan.reviewedBy = msg.sender;
        loan.status = LoanStatus.Rejected;

        emit LoanRejected(loanId, msg.sender);
    }

    function fundLoan(uint256 loanId) external payable onlyLender validLoan(loanId) nonReentrant {
        Loan storage loan = loans[loanId];

        require(loan.status == LoanStatus.Approved, "Loan not approved");
        require(loan.reviewedBy == msg.sender, "Only reviewing lender can fund");
        require(!loan.funded, "Loan already funded");
        require(msg.value == loan.loanAmount, "Incorrect funding amount");

        loan.lender = msg.sender;
        loan.funded = true;
        loan.status = LoanStatus.Active;
        loan.nextDueDate = block.timestamp + 30 days;

        ILoanRepayment(repaymentContract).generateEMISchedule(
            loanId,
            loan.totalPayable,
            loan.durationMonths,
            loan.nextDueDate
        );

        payable(loan.borrower).sendValue(msg.value);

        emit LoanFunded(loanId, msg.sender, msg.value);
    }

    function payEMI(uint256 loanId, uint256 emiIndex)
        external
        payable
        validLoan(loanId)
        onlyBorrower(loanId)
        nonReentrant
    {
        Loan storage loan = loans[loanId];

        require(loan.status == LoanStatus.Active, "Loan not active");
        require(loan.lender != address(0), "Lender missing");

        (uint256 pendingIndex, uint256 dueAmount,,) = ILoanRepayment(repaymentContract).getPendingEMI(loanId);
        require(pendingIndex == emiIndex, "Not pending EMI");
        require(dueAmount > 0, "Loan settled");
        require(msg.value >= dueAmount, "Insufficient EMI amount");

        (uint256 paidAmount, uint256 nextDueDate) = ILoanRepayment(repaymentContract).payEMI(loanId, emiIndex);

        loan.amountPaid += paidAmount;
        loan.remainingBalance = loan.totalPayable > loan.amountPaid ? loan.totalPayable - loan.amountPaid : 0;
        loan.emisPaid += 1;
        loan.nextDueDate = nextDueDate;

        payable(loan.lender).sendValue(paidAmount);

        if (msg.value > paidAmount) {
            payable(msg.sender).sendValue(msg.value - paidAmount);
        }

        emit EMIPaid(loanId, emiIndex, paidAmount);

        if (loan.remainingBalance == 0 || loan.emisPaid >= loan.durationMonths) {
            _completeLoan(loanId);
        }
    }

    function cancelPendingLoan(uint256 loanId) external validLoan(loanId) onlyBorrower(loanId) nonReentrant {
        Loan storage loan = loans[loanId];

        require(
            loan.status == LoanStatus.Pending || loan.status == LoanStatus.Rejected,
            "Loan cannot be cancelled"
        );

        loan.approved = false;
        loan.status = LoanStatus.Cancelled;
        loan.remainingBalance = 0;

        if (loan.nftContract != address(0) && loan.nftId != 0) {
            IPropertyEscrow(escrowContract).releaseToBorrower(loan.nftContract, loan.nftId);
        }

        emit LoanCancelled(loanId, loan.borrower);
    }

    function triggerDefault(uint256 loanId) external validLoan(loanId) nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.lender == msg.sender, "Only lender");
        require(canMarkDefault(loanId), "Loan healthy");
        _markDefault(loanId);
    }

    function canMarkDefault(uint256 loanId) public view validLoan(loanId) returns (bool) {
        Loan storage loan = loans[loanId];
        return loan.status == LoanStatus.Active && ILoanRepayment(repaymentContract).checkDefault(loanId);
    }

    function markDefaultFromAutomation(uint256 loanId) external onlyAutomation validLoan(loanId) {
        require(canMarkDefault(loanId), "Loan healthy");
        _markDefault(loanId);
    }

    function checkDefault(uint256 loanId) external view validLoan(loanId) returns (bool) {
        return canMarkDefault(loanId);
    }

    function getPendingEMI(uint256 loanId)
        external
        view
        validLoan(loanId)
        returns (uint256 emiIndex, uint256 amount, uint256 dueDate, bool overdue)
    {
        return ILoanRepayment(repaymentContract).getPendingEMI(loanId);
    }

    function getLoanEMIs(uint256 loanId)
        external
        view
        validLoan(loanId)
        returns (LoanRepayment.EMI[] memory)
    {
        return ILoanRepayment(repaymentContract).getLoanEMIs(loanId);
    }

    function getLoan(uint256 loanId) external view validLoan(loanId) returns (Loan memory) {
        return loans[loanId];
    }

    function viewLoanDetails(uint256 loanId) external view validLoan(loanId) returns (Loan memory) {
        return loans[loanId];
    }

    function getBorrowerLoans(address borrower) external view returns (uint256[] memory) {
        return borrowerLoans[borrower];
    }

    function getNextLoanId() external view returns (uint256) {
        return _nextLoanId;
    }

    function isOverdue(uint256 loanId) external view validLoan(loanId) returns (bool) {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active || loan.nextDueDate == 0) {
            return false;
        }

        return block.timestamp > loan.nextDueDate + 7 days;
    }

    function _createLoan(
        address borrower,
        address nftContract,
        uint256 nftId,
        uint256 loanAmount,
        uint256 interestRate,
        uint256 durationMonths
    ) internal returns (uint256 loanId) {
        require(borrower != address(0), "Borrower required");
        require(loanAmount > 0, "Loan amount must be > 0");
        require(interestRate > 0, "Interest rate must be > 0");
        require(durationMonths > 0, "Duration must be > 0");

        uint256 totalInterest = (loanAmount * interestRate * durationMonths) / (12 * 10000);
        uint256 totalPayable = loanAmount + totalInterest;
        uint256 emiAmount = totalPayable / durationMonths;

        if (emiAmount == 0) {
            emiAmount = totalPayable;
        }

        loanId = _nextLoanId++;
        loans[loanId] = Loan({
            id: loanId,
            exists: true,
            borrower: borrower,
            lender: address(0),
            reviewedBy: address(0),
            nftId: nftId,
            nftContract: nftContract,
            loanAmount: loanAmount,
            interestRate: interestRate,
            durationMonths: durationMonths,
            emiAmount: emiAmount,
            totalPayable: totalPayable,
            amountPaid: 0,
            remainingBalance: totalPayable,
            emisPaid: 0,
            nextDueDate: 0,
            createdAt: block.timestamp,
            approved: false,
            funded: false,
            status: LoanStatus.Pending
        });

        borrowerLoans[borrower].push(loanId);
    }

    function _completeLoan(uint256 loanId) internal {
        Loan storage loan = loans[loanId];

        loan.status = LoanStatus.Completed;
        loan.remainingBalance = 0;
        loan.nextDueDate = 0;

        if (loan.nftContract != address(0) && loan.nftId != 0) {
            IPropertyEscrow(escrowContract).releaseToBorrower(loan.nftContract, loan.nftId);
        }

        emit LoanCompleted(loanId, loan.borrower);
    }

    function _markDefault(uint256 loanId) internal {
        Loan storage loan = loans[loanId];
        loan.status = LoanStatus.Defaulted;
        loan.nextDueDate = 0;

        if (loan.nftContract != address(0) && loan.nftId != 0) {
            IPropertyEscrow(escrowContract).seizeToLender(loan.nftContract, loan.nftId, loan.lender);
        }

        emit LoanDefaulted(loanId, loan.borrower, loan.lender);
    }

    function _setLenderAuthorization(address lender, bool isAuthorized) internal {
        require(lender != address(0), "Invalid lender");
        authorizedLenders[lender] = isAuthorized;
        emit LenderAuthorizationUpdated(lender, isAuthorized);
    }

    function _setModules(
        address escrowAddress,
        address repaymentAddress,
        address verificationAddress
    ) internal {
        require(escrowAddress != address(0), "Invalid escrow");
        require(repaymentAddress != address(0), "Invalid repayment");
        require(verificationAddress != address(0), "Invalid verification");

        escrowContract = escrowAddress;
        repaymentContract = repaymentAddress;
        verificationContract = verificationAddress;

        emit ModulesUpdated(escrowAddress, repaymentAddress, verificationAddress);
    }
}
