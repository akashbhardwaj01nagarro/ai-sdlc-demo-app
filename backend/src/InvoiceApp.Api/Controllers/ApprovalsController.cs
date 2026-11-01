using InvoiceApp.Api.Auth;
using InvoiceApp.Domain;
using Microsoft.AspNetCore.Mvc;

namespace InvoiceApp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ApprovalsController : ApiControllerBase
{
    private readonly ApprovalService _approvals;

    public ApprovalsController(ApprovalService approvals)
    {
        _approvals = approvals;
    }

    public record RejectRequest(string Reason);

    // No role gate: every signed-in role reaches ApprovalPolicy, which refuses all but Managers and Directors with
    // RoleCannotApprove and a reason naming the invoice (FR-006).
    [HttpPost("{invoiceId}/approve")]
    public ActionResult<Invoice> Approve(string invoiceId)
    {
        var session = HttpContext.GetSession();
        return Handle(() => _approvals.Approve(invoiceId, new Approver(session.Username, session.Role)));
    }

    [HttpPost("{invoiceId}/reject")]
    // Admin passes the gate so it can reject, although ApprovalPolicy refuses its approvals.
    [RequireRole(ApprovalRoles.Manager, ApprovalRoles.Director, ApprovalRoles.Admin)]
    public ActionResult<Invoice> Reject(string invoiceId, [FromBody] RejectRequest request) =>
        Handle(() => _approvals.Reject(invoiceId, HttpContext.GetSession().Username, request.Reason));
}
